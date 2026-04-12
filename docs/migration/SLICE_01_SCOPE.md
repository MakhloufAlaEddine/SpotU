# SLICE_01_SCOPE.md — Cadrage de la Slice 01
> Basé sur analyse directe du code Python (`server.py:183–237`) et requêtes DB live (Supabase).  
> Généré le 2026-04-12.

---

## Endpoints inclus

| # | Méthode | Chemin | Fichier Python | Lignes |
|---|---|---|---|---|
| 1 | GET | `/api/config/booking` | `server.py` | 183–200 |
| 2 | GET | `/api/config/commission` | `server.py` | 202–237 |

---

## Endpoints explicitement exclus de cette slice

| Endpoint | Raison d'exclusion |
|---|---|
| `GET /api/liveness` | Déjà implémenté en Java (stub + DB check) |
| `GET /api/readiness` | Déjà implémenté en Java (stub + DB check) |
| `GET /api/admin/app-config` | Admin uniquement — dépend de l'auth (Slice 2+) |
| `PUT /api/admin/app-config` | Admin uniquement — dépend de l'auth (Slice 2+) |
| `GET /api/admin/pricing-rules` | Admin uniquement — dépend de l'auth (Slice 2+) |
| `POST /api/admin/pricing-rules` | Admin uniquement — dépend de l'auth (Slice 2+) |

---

## Dépendances exactes

### Dépendances requises (toutes déjà présentes en Java)

| Dépendance | Type | Détail |
|---|---|---|
| Connexion PostgreSQL (Supabase) | Infrastructure | HikariCP ou Spring DataSource déjà configuré |
| Table `app_config` | DB | Lue par `/config/booking` |
| Table `pricing_rules` | DB | Lue par `/config/commission` |

### Absence de dépendances (confirmé)

- ❌ Pas d'auth (JWT, session, role)
- ❌ Pas de Stripe
- ❌ Pas d'upload
- ❌ Pas de workers
- ❌ Pas de WebSocket
- ❌ Pas de push notifications
- ❌ Pas de cache Redis
- ❌ Pas de logique métier complexe

---

## Niveau de risque

**TRÈS FAIBLE.**

- 2 endpoints en lecture seule, sans auth
- 0 effet de bord (pas d'écriture en DB)
- Logique applicative minimale (2 conversions de type, 1 addition)
- Les tables sont petites : `app_config` = 3 lignes, `pricing_rules` = 7 lignes (1 active)

---

## Raisons du choix de cette slice

1. **Zéro prérequis** : aucune auth, aucun service tiers, aucun worker
2. **Valide le pipeline DB complet** : connexion → requête → DTO → réponse JSON
3. **Valide la convention de nommage des colonnes** : `NUMERIC` → `double`, `TEXT` → `String`, `BOOLEAN` → `boolean`
4. **Retour immédiat mesurable** : les stubs Java existants retournent des valeurs en dur — cette slice les remplace par des vraies valeurs dynamiques depuis la DB
5. **Expose 2 pièges courants** dès la Slice 1 : conversion `NUMERIC` PostgreSQL et fallback sur clé absente

---

## Pièges éventuels

| # | Piège | Détail | Mitigation |
|---|---|---|---|
| P1 | Conversion `NUMERIC` → `double` | PostgreSQL `NUMERIC` → `BigDecimal` en JDBC. Python utilise `float()`. En Java, utiliser `doubleValue()` ou `BigDecimal.doubleValue()`. NE PAS utiliser `getInt()` sur une colonne NUMERIC. | Voir SLICE_01_BUSINESS_RULES.md §BR-05 |
| P2 | Fallback `pay_now_checkout_minutes` | Le code Python a un fallback par défaut de `"30"` mais la valeur réelle en DB est `"5"`. Si la clé est absente, Java retournera `30` (cohérent avec Python) — mais ce n'est PAS la valeur en prod. | Documenter explicitement le fallback dans le DTO |
| P3 | Absence de règle de commission | Si `pricing_rules` n'a aucune ligne `active=TRUE` pour `service_booking`, retourner le payload zéro avec `has_rule: false`. Ne PAS lever d'exception. | Voir SLICE_01_BUSINESS_RULES.md §BR-08 |
