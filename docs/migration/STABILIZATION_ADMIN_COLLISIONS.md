# STABILIZATION_ADMIN_COLLISIONS.md — Analyse des collisions admin
> Basé sur `ARBITRAGE_DECISIONS.md:ARB-001, ARB-002`, `ROUTE_COLLISIONS_AND_AMBIGUITIES.md`, `payment_routes.py:497`, `subscription_routes.py:451`, `admin_routes.py:210`, `subscription_routes.py:151`.
> Généré le 2026-02-XX.

---

## Résumé des 2 collisions réelles

Ces 2 collisions existent dans le code Python mais sont **transparentes car FastAPI résout silencieusement** (premier handler enregistré gagne). En Java/Spring Boot, elles provoquent une erreur fatale au démarrage.

---

## Collision 1 — GET /api/admin/subscriptions

### Endpoints en conflit

| | Fichier A (GAGNE) | Fichier B (MORT) |
|---|---|---|
| Fichier | `payment_routes.py:497` | `subscription_routes.py:453` |
| Fonction | `admin_subscriptions` | `admin_list_subscriptions` |
| Chemin déclaré | `/admin/subscriptions` (sans préfixe router) | `/admin/subscriptions` (sans préfixe router) |
| Chemin résolu | `/api/admin/subscriptions` | `/api/admin/subscriptions` |
| Enregistrement `server.py` | Ligne 106 → **en premier** | Ligne 107 → jamais appelé |

### Requêtes SQL comparées

```sql
-- payment_routes.py:497 (HANDLER ACTIF)
SELECT us.*, u.name, u.email, sp.name AS plan_name, sp.price AS plan_price
FROM user_subscriptions us
LEFT JOIN users u ON u.user_id = us.user_id
LEFT JOIN subscription_plans sp ON sp.plan_id = us.plan_id
ORDER BY created_at DESC

-- subscription_routes.py:453 (HANDLER MORT — jamais appelé)
SELECT us.*, u.name, u.email, sp.name AS plan_name, sp.price AS plan_price
FROM user_subscriptions us
LEFT JOIN users u ON u.user_id = us.user_id
LEFT JOIN subscription_plans sp ON sp.plan_id = us.plan_id
ORDER BY created_at DESC
```

**Résultat : requêtes quasi-identiques.** Le handler mort n'apportait aucune différence fonctionnelle.

### Décision (ARB-001)

**Garder uniquement `payment_routes.py:497`** comme référence Java.
Route `subscription_routes.py:453` → **exclue définitivement du périmètre de migration.**

---

## Collision 2 — GET /api/admin/subscription-plans

### Endpoints en conflit

| | Fichier A (GAGNE) | Fichier B (MORT) |
|---|---|---|
| Fichier | `admin_routes.py:210` | `subscription_routes.py:151` |
| Fonction | `list_subscription_plans` | `admin_list_plans` |
| Chemin déclaré | `/subscription-plans` (router préfixe `/admin`) | `/admin/subscription-plans` (sans préfixe) |
| Chemin résolu | `/api/admin/subscription-plans` | `/api/admin/subscription-plans` |
| Enregistrement `server.py` | Ligne 102 → **en premier** | Ligne 107 → jamais appelé |

### Différence SQL (critique)

```sql
-- admin_routes.py:210 (HANDLER ACTIF)
SELECT * FROM subscription_plans ORDER BY priority DESC, created_at  -- ASC implicite

-- subscription_routes.py:151 (HANDLER MORT)
SELECT * FROM subscription_plans ORDER BY priority DESC, created_at DESC
```

**ORDER BY différent :** `created_at ASC` (actif) vs `created_at DESC` (mort).
→ Le frontend voit actuellement les plans triés avec `created_at ASC` (plus ancien en dernier si même priority).

### Décision (ARB-002)

**Garder uniquement `admin_routes.py:210`** comme référence Java.
Conserver `ORDER BY priority DESC, created_at` (ASC implicite) → comportement actuel exact.
Route `subscription_routes.py:151` → **exclue définitivement.**

**Validation humaine requise :** confirmer si `ORDER BY created_at ASC` est intentionnel ou si `DESC` était voulu.

---

## Impact sur Spring Boot

Sans résolution, Spring Boot lève à l'enregistrement des routes :

```
java.lang.IllegalStateException: Ambiguous handler methods mapped for '/api/admin/subscriptions'
```

→ **Le serveur Java ne démarre pas.** Ces collisions DOIVENT être résolues avant tout déploiement incluant les routes admin.

---

## Stratégie de test contre Python

Avant de finaliser les décisions, valider les réponses des handlers Python actifs via HTTP réel.

### Test Collision 1 — Vérifier le handler actif

```bash
# Test depuis l'environnement Python actuel
TOKEN="<admin_jwt_token>"
curl -s -H "Authorization: Bearer $TOKEN" \
     "http://localhost:8001/api/admin/subscriptions" | python3 -m json.tool | head -30
```

**Vérifier :**
- Les champs retournés : `user_id`, `user_name`, `user_email`, `plan_name`, `plan_price`, `created_at`
- L'ordre de tri : `created_at DESC` (plus récent en premier)
- La réponse correspond à `payment_routes.py:497`

### Test Collision 2 — Vérifier l'ordre de tri actuel

```bash
TOKEN="<admin_jwt_token>"
curl -s -H "Authorization: Bearer $TOKEN" \
     "http://localhost:8001/api/admin/subscription-plans" | python3 -c "
import sys, json
plans = json.load(sys.stdin)
for p in plans:
    print(p.get('priority'), p.get('created_at'), p.get('name'))
"
```

**Vérifier :**
- Les plans sont triés par `priority DESC` en premier
- Pour même priority : ordre `created_at ASC` ou `DESC` ?
- Confirme la décision ARB-002

---

## Recommandation finale

| Collision | Action Java | Handler de référence | Fichier exclu |
|---|---|---|---|
| `GET /api/admin/subscriptions` | `AdminController#getSubscriptions` | `payment_routes.py:497` | `subscription_routes.py:453` |
| `GET /api/admin/subscription-plans` | `AdminController#getSubscriptionPlans` | `admin_routes.py:210` | `subscription_routes.py:151` |

**Implémentation Java :**
```java
// AdminController.java — 2 méthodes distinctes sans ambiguïté
@GetMapping("/admin/subscriptions")
public ResponseEntity<List<SubscriptionDto>> getSubscriptions() { ... }

@GetMapping("/admin/subscription-plans")
public ResponseEntity<List<SubscriptionPlanDto>> getSubscriptionPlans() { ... }
```

---

## Routes admin sans collision (pour mémoire)

Les routes suivantes **ne sont PAS des collisions** (préfixes différents) mais ont souvent été confondues :

| Route publique | Route admin | Collision ? |
|---|---|---|
| `GET /api/domains` | `GET /api/admin/domains` | NON — préfixes distincts |
| `GET /api/services` | `GET /api/admin/services` | NON |
| `GET /api/tag-points` | `GET /api/admin/tag-points` | NON |
| `GET /api/subscription-plans` | `GET /api/admin/subscription-plans` | NON |

En Java, la séparation naturelle `AdminController` / `ServiceController` / `DomainController` élimine ces fausses ambiguïtés.

---

## Validation humaine requise

| Question | Impact |
|---|---|
| Collision 1 : le frontend admin lit-il les abonnements depuis `/admin/subscriptions` ou depuis un autre endpoint ? | Confirme ARB-001 |
| Collision 2 : l'ordre `created_at ASC` est-il intentionnel sur les plans ? | Confirme ARB-002 ORDER BY |
| Les deux routes mortes (`subscription_routes.py:453` et `subscription_routes.py:151`) peuvent-elles être exclues définitivement ? | Sécurise l'exclusion |
