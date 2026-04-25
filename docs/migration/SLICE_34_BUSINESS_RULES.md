# SLICE_34_BUSINESS_RULES.md — Règles métier Payment Reads
> Basé sur `routes/payment_routes.py:32–80`, `auth_utils.py:71–83`.
> Généré le 2026-04-25.

---

## BR-34.01 — Auth obligatoire pour les 2 endpoints

### Règle

```python
user = await require_auth(request, pool)
```

`require_auth` :
1. Lit le token depuis `Authorization: Bearer ...` OU cookie `winek_token`
2. Décode le JWT (signature + exp)
3. SELECT user dans `users` WHERE `user_id=payload.user_id`
4. Lève `HTTPException(401, "Not authenticated")` si pas de token
5. Lève `HTTPException(401, "User not found")` si user supprimé

### Java

```java
@Component
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepo;
    private final JwtDecoder jwtDecoder;

    public User requireAuth(HttpServletRequest request) {
        String token = extractToken(request);
        if (token == null) throw new UnauthorizedException("Not authenticated");

        JwtPayload payload = jwtDecoder.decode(token);
        return userRepo.findById(payload.userId())
            .orElseThrow(() -> new UnauthorizedException("User not found"));
    }

    private String extractToken(HttpServletRequest req) {
        String h = req.getHeader("Authorization");
        if (h != null && h.startsWith("Bearer ")) return h.substring(7);
        if (req.getCookies() != null) {
            for (Cookie c : req.getCookies()) {
                if ("winek_token".equals(c.getName())) return c.getValue();
            }
        }
        return null;
    }
}
```

> ⚠️ Spring Security alternative : configurer un `BearerTokenAuthenticationFilter` + `OAuth2ResourceServer` ; mais le pattern Python est plus léger. **Reproduire le pattern simple** sauf si Spring Security est déjà adopté ailleurs (alors aligner).

---

## BR-34.02 — `/payments/me` filtre user-scope automatique

### Règle (lignes 41–59)

```sql
WHERE p.payer_user_id = $uid OR p.receiver_user_id = $uid
```

Le filtrage est **dans la requête SQL**, pas applicatif. Aucun moyen pour un user de voir des paiements d'un autre user via `/me`.

### Java
```java
@Query(value = """
    SELECT p.*,
           u_pay.name AS payer_name,
           u_recv.name AS receiver_name
      FROM payments p
      LEFT JOIN users u_pay  ON u_pay.user_id  = p.payer_user_id
      LEFT JOIN users u_recv ON u_recv.user_id = p.receiver_user_id
     WHERE p.payer_user_id = :uid OR p.receiver_user_id = :uid
     ORDER BY p.created_at DESC
""", nativeQuery = true)
List<PaymentWithNamesRow> findByUserId(@Param("uid") String uid);
```

---

## BR-34.03 — `/payments/{id}` permissions 3-conditions OR

### Règle (lignes 73–79)

```python
if (
    d["payer_user_id"] != user["user_id"]
    and d["receiver_user_id"] != user["user_id"]
    and user.get("role") != "admin"
):
    raise HTTPException(403, "Access denied")
```

Logique : **403** sauf si **AU MOINS UNE** condition vraie :
1. user est le payer
2. user est le receiver
3. user est admin

### Matrice

| User | Payer match ? | Receiver match ? | Admin ? | Résultat |
|---|---|---|---|---|
| Buyer | ✅ | — | — | 200 |
| Coach | — | ✅ | — | 200 |
| Admin (autre) | — | — | ✅ | 200 |
| Autre user lambda | — | — | — | **403** |

### Java
```java
public Payment getById(String paymentId, User user) {
    Payment p = paymentRepo.findById(paymentId)
        .orElseThrow(() -> new NotFoundException("Payment not found"));

    boolean isPayer    = user.userId().equals(p.payerUserId());
    boolean isReceiver = user.userId().equals(p.receiverUserId());
    boolean isAdmin    = "admin".equals(user.role());

    if (!isPayer && !isReceiver && !isAdmin) {
        throw new ForbiddenException("Access denied");
    }
    return deserialize(p);
}
```

> ⚠️ **Ne pas** utiliser `@PreAuthorize` Spring Security à la place (changement de contrat de l'erreur 403). Garder la logique applicative explicite.

---

## BR-34.04 — Ordre des erreurs : 401 → 404 → 403

### Règle implicite (Python)

L'ordre des checks dans `get_payment` :
```
1. require_auth         → 401 si KO
2. SELECT ... WHERE id  → si row null → 404
3. permissions check    → 403 si KO
```

**Conséquence** : un user lambda qui demande un `payment_id` inexistant reçoit **404** (pas 403). Un user lambda qui demande un `payment_id` existant mais d'un autre user reçoit **403**.

> ⚠️ Cette asymétrie **révèle l'existence/non-existence** d'un payment_id à un attaquant. **C'est documenté/intentionnel** côté Python. **Ne pas "corriger"** en uniformisant à 404 partout — ça casserait le contrat front (même si c'est une bonne pratique sécurité).

### Java
```java
// 1. Filtre Spring Security ou WebMvc handler → 401 avant que la méthode soit appelée
// 2. Dans la méthode :
Payment p = paymentRepo.findById(paymentId)
    .orElseThrow(() -> new NotFoundException("Payment not found"));   // 404

// 3. Permissions
if (!isPayer && !isReceiver && !isAdmin) {
    throw new ForbiddenException("Access denied");                     // 403
}
```

---

## BR-34.05 — Aucune pagination, aucun filtre

### Règle

`/payments/me` retourne **tout** sans pagination ni filtrage par status.

### Justification produit
Le front actuel charge la liste complète puis filtre côté client (faible volume attendu : ~10–50 paiements/user max). Si volume explose → ajouter pagination en slice future.

### Java
```java
// PAS de Pageable, PAS de @RequestParam("status")
@GetMapping("/payments/me")
public List<PaymentDto> myPayments(HttpServletRequest req) {
    User user = authService.requireAuth(req);
    return paymentService.findByUser(user.userId());
}
```

> ⚠️ **Ne PAS ajouter** `?page=...&size=...` ni `?status=...` même si Spring le permet facilement. **Compat stricte = pas de query params.**

---

## BR-34.06 — Tri `created_at DESC` non-négociable

### Règle (ligne 56)
```sql
ORDER BY p.created_at DESC
```

### Justification UX
Le front affiche les paiements du plus récent au plus ancien. Inverser → casse l'UX.

### Java
Garder `ORDER BY p.created_at DESC` dans la query native.

---

## BR-34.07 — JOIN names uniquement sur `/me`, pas sur `/{id}`

### Asymétrie

| Endpoint | `payer_name` | `receiver_name` |
|---|---|---|
| `/payments/me` | ✅ inclus (LEFT JOIN) | ✅ inclus |
| `/payments/{id}` | ❌ absent | ❌ absent |

### Justification implicite
Le front sur `/me` affiche un tableau avec les noms ; sur `/{id}` il fait probablement un fetch séparé `users/{id}` ou affiche juste les IDs.

### Java
2 DTOs distincts :
```java
public record PaymentListItemDto(/* payment fields */, String payerName, String receiverName) {}
public record PaymentDetailDto(/* payment fields, sans names */) {}
```

> ⚠️ **Ne pas** uniformiser (ajouter les names sur `/{id}`). Compat stricte.

---

## BR-34.08 — `_deserialize` conditionnelle

### Règle (lignes 32–36)
```python
def _deserialize(d: dict) -> dict:
    if d.get("pricing_rule_snapshot") and isinstance(d["pricing_rule_snapshot"], str):
        d["pricing_rule_snapshot"] = json.loads(d["pricing_rule_snapshot"])
    return d
```

### Comportement
- Si `pricing_rule_snapshot` est string non-vide → parse en dict
- Si déjà dict (asyncpg JSONB codec) → laisse
- Si null → laisse

### Java
Selon le mapping JPA de la colonne :
- TEXT mapped en `String` → toujours désérialiser
- JSONB mapped en `Map<String,Object>` (hibernate-types) → ne rien faire (déjà dict)

> ⚠️ **Choisir une approche** et la documenter en `application.yml` / `@Type`. Ne pas mélanger.

---

## BR-34.09 — `row_to_dict` reproduction conformité

### Règle (database.py:53–65)

| Type Python | Conversion |
|---|---|
| `Decimal` | → `float` |
| objet avec `.isoformat()` | → string ISO |
| autre | inchangé |

### Java mapping

| Type Postgres | Type Java | Sérialisation Jackson |
|---|---|---|
| NUMERIC | `BigDecimal` | number JSON (configurer `WRITE_BIGDECIMAL_AS_PLAIN`) |
| TIMESTAMPTZ | `OffsetDateTime` | string ISO **avec `+00:00`** (pas `Z`) |
| TEXT | `String` | string |
| JSONB | `Map<String,Object>` | object |
| BOOLEAN | `Boolean` | boolean |

### Configuration Jackson recommandée

```java
@Configuration
public class JacksonConfig {
    @Bean
    ObjectMapper objectMapper() {
        return new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .configure(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS, false)
            .configure(SerializationFeature.WRITE_BIGDECIMAL_AS_PLAIN, true)
            .setSerializerProvider(/* custom OffsetDateTime serializer pour +00:00 */);
    }
}
```

---

## BR-34.10 — Pas de transformation `snake_case` ↔ `camelCase`

### Règle implicite

Le code Python retourne directement les colonnes telles que (snake_case PostgreSQL).

### Java
**Configurer Jackson en snake_case** pour ces 2 endpoints :
```java
@Configuration
public class PaymentJsonConfig {
    @Bean(name = "paymentObjectMapper")
    ObjectMapper paymentObjectMapper() {
        return new ObjectMapper()
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
            .registerModule(...);
    }
}
```

OU les DTO records utilisent directement les noms snake_case via `@JsonProperty`.

> ⚠️ Si le front mobile a déjà été codé pour s'attendre à `payer_user_id` etc., **ne PAS changer** en `payerUserId`. Compat stricte.

---

## BR-34.11 — Liste vide = `[]`, pas 404

### Règle
```python
return [_deserialize(row_to_dict(r)) for r in rows]
```

Si `rows` vide → `return []`. Pas de 404.

### Java
```java
@GetMapping("/payments/me")
public List<PaymentListItemDto> myPayments(...) {
    return paymentService.findByUser(user.userId());  // peut être empty list
}
```

> ⚠️ Ne **PAS** retourner `{"payments": [], "total": 0}` ni 404.

---

## BR-34.12 — Pas de filtre soft-delete

### Règle
Aucun filtre `WHERE deleted_at IS NULL` dans les queries Python.

### Java
**Ne PAS** ajouter de filtre soft-delete sauf si le code Python le fait. Si `payments` n'a pas de soft-delete → ne pas en inventer.

> ⚠️ À vérifier sur le schéma : `payments.deleted_at` n'apparaît pas dans le code → probablement pas de soft-delete sur cette table.

---

## BR-34.13 — Interaction avec slices migrées

| Slice | Interaction | Notes |
|---|---|---|
| **S30** (booking pay) | Crée les rows lues par S34 | Aucune dépendance directe ; S34 est read-only |
| **S31** (checkout status) | Mute `status` ; S34 lit l'état courant | Cohérence assurée par MVCC PostgreSQL |
| **S32** (webhook infra) | — | Pas d'interaction directe |
| **S33** (webhook payment handlers) | Mute `status`, `stripe_charge_id` ; S34 lit l'état courant | Idem |
| **S35 (futur — refunds)** | Mute `status='refunded'` / `'partially_refunded'` ; S34 doit afficher correctement ces statuts | Aucun changement de S34 nécessaire |
| **S36 (futur — bookings reads)** | Pattern identique à S34 (require_auth + WHERE OR + permissions) | Réutiliser le pattern |

---

## BR-34.14 — Asymétries à préserver

| Aspect | Python | Java doit reproduire |
|---|---|---|
| `/me` JOIN names, `/{id}` non | OUI | ✅ |
| `404 avant 403` sur `/{id}` | OUI | ✅ |
| Liste vide = `[]` | OUI | ✅ |
| Pas de pagination | OUI | ✅ |
| Pas de filtre status | OUI | ✅ |
| Tri `created_at DESC` | OUI | ✅ |
| Auth dual Bearer/cookie | OUI | ✅ |
| `pricing_rule_snapshot` désérialisation conditionnelle | OUI | ✅ |
| `SELECT *` toutes colonnes | OUI | ✅ |
| Format datetime `+00:00` (pas `Z`) | OUI | ✅ configurer Jackson |
| Décimal → float (perte précision possible) | OUI | ✅ ou BigDecimal en number |

---

## BR-34.15 — Limitations connues (à NE PAS corriger)

| Limitation | Reproduire ? |
|---|---|
| Pas de pagination → réponse potentiellement grosse | OUI |
| 404 vs 403 révèle l'existence d'un payment_id | OUI (compat stricte) |
| `SELECT *` expose toutes les colonnes (incluant internes) | OUI |
| Pas de cache HTTP | OUI |
| Pas de rate limiting visible | OUI (sauf si géré côté gateway) |
| Pas de logs d'audit (qui consulte quel payment) | OUI |
| Pas de différenciation buyer/seller view (les 2 voient les mêmes champs) | OUI |
