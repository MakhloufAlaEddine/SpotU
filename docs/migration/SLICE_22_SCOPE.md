# SLICE_22_SCOPE.md — Cadrage de la Slice 22
> Basé sur `admin_routes.py:208–283`, `subscription_routes.py:151–160,453–511`.
> Généré le 2026-04-13.

---

## Flow choisi — Admin Subscription & Plans complet (CRUD plans + gestion subscriptions)

### Cible

Documenter les **7 endpoints admin** répartis dans 2 fichiers qui couvrent la gestion complète des plans et abonnements côté administrateur.

| # | Méthode | Chemin API effectif | Fichier source | Auth |
|---|---|---|---|---|
| 1 | GET | `/api/admin/subscription-plans` | `admin_routes.py:210` | admin |
| 1bis | GET | `/api/admin/subscription-plans` | `subscription_routes.py:151` | admin |
| 2 | POST | `/api/admin/subscription-plans` | `admin_routes.py:221` | admin |
| 3 | PUT | `/api/admin/subscription-plans/{plan_id}` | `admin_routes.py:252` | admin |
| 4 | DELETE | `/api/admin/subscription-plans/{plan_id}` | `admin_routes.py:277` | admin |
| 5 | GET | `/api/admin/subscriptions` | `subscription_routes.py:453` | admin |
| 6 | POST | `/api/admin/subscriptions/{subscription_id}/cancel` | `subscription_routes.py:472` | admin |

---

## Anomalie détectée — Double endpoint GET plans

```
⚠️ DUPLICATION : GET /api/admin/subscription-plans existe DEUX FOIS :

1. admin_routes.py:210 — monté via prefix="/admin" → path="/subscription-plans"
   → Utilise rows_to_list(rows) — retourne TOUS les champs (y compris stripe_*)
   → ORDER BY priority DESC, created_at (ASC implicite)

2. subscription_routes.py:151 — monté SANS prefix → path="/admin/subscription-plans"
   → Utilise [row_to_dict(r) for r in rows] — idem mais sérialisation différente
   → ORDER BY priority DESC, created_at DESC

FastAPI enregistre les DEUX. Le premier match (admin_routes, enregistré ligne 102
de server.py) est probablement appelé en priorité. Le second (subscription_routes,
ligne 107) est un doublon mort.

EN JAVA : Implémenter UN SEUL endpoint. Choisir le comportement d'admin_routes.py
(SELECT * + rows_to_list) car c'est le handler effectivement appelé.
```

---

## Justification du choix

### Pourquoi tout l'admin subscription en une slice ?

| Critère | Justification |
|---|---|
| **6 endpoints uniques** | Assez pour une slice, pas trop pour fragmenter |
| **CRUD complet** | Create + Read + Update + Delete plans = un composant cohérent |
| **Gestion subscriptions** | List + Cancel admin = complète la S21 côté admin |
| **Mêmes tables** | `subscription_plans` + `user_subscriptions` — tout le domaine |
| **Clôture du domaine** | Après S22, le domaine subscription est INTÉGRALEMENT documenté (S19→S22) |

### Pourquoi MAINTENANT ?

| Critère | Valeur |
|---|---|
| S21 (user endpoints) terminé | Les endpoints utilisateur sont en place — l'admin les complète |
| CRUD plans = fondation | Les plans admin sont requis pour que POST /subscribe fonctionne (un plan doit exister) |
| Admin cancel = symétrique de user cancel (S21) | Même logique avec `subscription_id` au lieu de `user_id` lookup |

---

## Fichiers Python analysés

| Fichier | Lignes | Rôle |
|---|---|---|
| `admin_routes.py` | 208–283 | CRUD subscription_plans (list, create, update, delete) |
| `subscription_routes.py` | 151–160 | GET admin plans (DOUBLON — handler mort) |
| `subscription_routes.py` | 453–469 | GET admin subscriptions list |
| `subscription_routes.py` | 472–511 | POST admin cancel subscription |

---

## Dépendances

| Dépendance | Type | Endpoints |
|---|---|---|
| Table `subscription_plans` | DB (CRUD) | 1, 2, 3, 4 |
| Table `user_subscriptions` | DB (SELECT + UPDATE) | 5, 6 |
| Table `users` | DB (SELECT — JOIN) | 5 |
| `stripe_service.cancel_subscription()` | Stripe réseau | 6 |
| `require_role(request, pool, "admin")` | Auth | Tous |
| `new_id("plan")` | ID generator | 2 |

---

## Scope explicite

### INCLUS (Slice 22)

- 4 CRUD endpoints plans (admin_routes.py)
- 2 admin subscription endpoints (subscription_routes.py)
- Documentation de la duplication GET plans

### EXCLU

| Composant | Raison |
|---|---|
| Admin CRUD plans Stripe (Product/Price) | Géré automatiquement par `_get_or_create_stripe_price` dans S21 |
| Admin CRUD `app_config` | Domaine config global, pas subscriptions |
| Admin payments (dashboard) | Domaine payments, pas subscriptions |

---

## Niveau de risque

**FAIBLE.**

| Point | Risque |
|---|---|
| CRUD plans : opérations simples | TRÈS FAIBLE |
| DELETE plan avec abonnements actifs | FAIBLE (FK constraint possible, mais le code ne vérifie pas) |
| UPDATE plan : champs dynamiques | FAIBLE (SQL dynamique mais set limité à `allowed`) |
| Admin cancel : Stripe call | FAIBLE (même pattern que S21 user cancel) |
| Duplication GET plans | FAIBLE (à documenter, pas de risque fonctionnel) |

---

## Résumé ultra court

- **Flow choisi** : Admin complet subscriptions/plans — CRUD plans (4 endpoints) + gestion subscriptions (2 endpoints)
- **Tables touchées** : `subscription_plans` (SELECT, INSERT, UPDATE, DELETE), `user_subscriptions` (SELECT, UPDATE), `users` (SELECT JOIN)
- **Top 3 pièges** :
  1. **Duplication GET plans** : 2 handlers pour le même chemin (`admin_routes.py` vs `subscription_routes.py`) — en Java, n'en implémenter qu'UN
  2. **DELETE plan sans guard** : `DELETE FROM subscription_plans WHERE plan_id=$1` sans vérifier les abonnements actifs liés — la FK `user_subscriptions.plan_id → subscription_plans.plan_id` pourrait lever une erreur si des subscriptions existent
  3. **UPDATE dynamique** : la construction SQL est dynamique (`SET {k}=$N`) avec un set `allowed` de 10 champs — en Java, utiliser un DTO partiel ou `@DynamicUpdate`
- **Raison du choix** : clôture complète du domaine subscription (S19 Stripe réseau → S20 webhooks → S21 user endpoints → S22 admin)
