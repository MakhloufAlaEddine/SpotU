# SLICE_21_SCOPE.md — Cadrage de la Slice 21
> Basé sur `subscription_routes.py:130–449`, `stripe_service.py:354–535` (méthodes subscription).
> Généré le 2026-04-13.

---

## Flow choisi — Cycle abonnement utilisateur complet (6 endpoints)

### Cible

Documenter les **6 endpoints utilisateur** de `subscription_routes.py` qui forment le cycle complet de souscription côté utilisateur. Après S21, le parcours abonnement est entièrement documenté de la découverte à l'annulation.

| # | Méthode | Chemin Python | Chemin Java | Auth | Complexité |
|---|---|---|---|---|---|
| 1 | GET | `/api/subscription-plans` | `/api/subscription-plans` | **AUCUNE** (public) | FAIBLE |
| 2 | POST | `/api/subscriptions/subscribe` | `/api/subscriptions/subscribe` | STRICTE | **ÉLEVÉE** |
| 3 | GET | `/api/subscriptions/checkout/status/{session_id}` | `/api/subscriptions/checkout/status/{sessionId}` | STRICTE | MOYENNE |
| 4 | GET | `/api/subscriptions/me` | `/api/subscriptions/me` | STRICTE | FAIBLE |
| 5 | GET | `/api/subscriptions/history` | `/api/subscriptions/history` | STRICTE | FAIBLE |
| 6 | POST | `/api/subscriptions/cancel` | `/api/subscriptions/cancel` | STRICTE | MOYENNE |

---

## Justification du choix

### Pourquoi les 6 ensemble ?

| Critère | Justification |
|---|---|
| **Même fichier** | Les 6 sont dans `subscription_routes.py:130–449` |
| **Mêmes helpers** | `_plan_to_dict`, `_sub_to_dict`, `_get_or_create_stripe_price`, `_build_benefits_snapshot` |
| **Cycle complet** | Plans → Subscribe → Checkout status → /me → Cancel → History |
| **Reads triviaux** | 4 des 6 sont des lectures simples (1–2 queries) — les documenter séparément gaspillerait des slices |
| **Writes cohérents** | Subscribe + Cancel = les 2 seules actions write, liées par le même contexte Stripe |

### Pourquoi MAINTENANT ?

| Critère | Valeur |
|---|---|
| S20 (webhook) en place | Les webhooks créent/mettent à jour `user_subscriptions` → les endpoints peuvent les lire |
| S19 (StripePaymentService) en place | La base Stripe SDK Java est prête |
| Ferme le cycle utilisateur | Après S21, un utilisateur peut : voir les plans, souscrire, vérifier le statut, consulter son abonnement, l'annuler |
| Admin séparable | Les endpoints admin (S22) sont indépendants et moins prioritaires |

### Parcours utilisateur documenté après S21

```
[User]
  │
  ├─ 1. GET /subscription-plans            → Voit les plans actifs
  ├─ 2. POST /subscriptions/subscribe      → Redirect Stripe Checkout
  │     └─ Stripe Checkout (hors app)
  │        └─ checkout.session.completed    → S20 (webhook) → INSERT user_subscriptions
  ├─ 3. GET /checkout/status/{session_id}  → Polling post-redirect
  ├─ 4. GET /subscriptions/me              → Voit son abonnement actif
  ├─ 5. POST /subscriptions/cancel         → Annulation (at_period_end)
  │     └─ customer.subscription.updated   → S20 (webhook) → UPDATE cancelling
  │     └─ customer.subscription.deleted   → S20 (webhook) → UPDATE cancelled
  └─ 6. GET /subscriptions/history         → Historique complet
```

---

## Fichiers Python analysés

| Fichier | Lignes | Rôle |
|---|---|---|
| `subscription_routes.py` | 130–148 | `GET /subscription-plans` |
| `subscription_routes.py` | 165–196 | `GET /subscriptions/me` |
| `subscription_routes.py` | 199–214 | `GET /subscriptions/history` |
| `subscription_routes.py` | 217–322 | `POST /subscriptions/subscribe` |
| `subscription_routes.py` | 325–401 | `POST /subscriptions/cancel` |
| `subscription_routes.py` | 404–448 | `GET /subscriptions/checkout/status/{session_id}` |
| `subscription_routes.py` | 42–125 | Helpers (`_plan_to_dict`, `_sub_to_dict`, `_get_or_create_stripe_price`, `_build_benefits_snapshot`) |
| `stripe_service.py` | 55–77 | `get_or_create_customer()` |
| `stripe_service.py` | 354–500 | `ensure_subscription_price()`, `create_subscription_checkout_session()` |
| `stripe_service.py` | 503–535 | `cancel_subscription()`, `retrieve_subscription()` |
| `stripe_service.py` | 349–351 | `retrieve_checkout_session()` |

---

## Dépendances

| Dépendance | Type | Endpoints concernés |
|---|---|---|
| Table `subscription_plans` | DB (SELECT) | plans, subscribe |
| Table `user_subscriptions` | DB (SELECT, UPDATE) | me, history, cancel, checkout/status |
| Table `users` | DB (UPDATE stripe_customer_id) | subscribe |
| `stripe_service.get_or_create_customer()` | Stripe réseau | subscribe |
| `stripe_service.ensure_subscription_price()` | Stripe réseau | subscribe |
| `stripe_service.create_subscription_checkout_session()` | Stripe réseau | subscribe |
| `stripe_service.cancel_subscription()` | Stripe réseau | cancel |
| `stripe_service.retrieve_checkout_session()` | Stripe réseau | checkout/status |
| `_duration_to_interval()` | Validation interne | subscribe |
| `require_auth` | Auth | 5 endpoints (tous sauf plans) |
| S20 webhook handler | Dépendance amont | subscribe + cancel (effets asynchrones) |

---

## Scope explicite

### INCLUS (Slice 21)

- 6 endpoints utilisateur
- 4 helpers internes
- 5 méthodes `stripe_service.py` subscription (documentation des contrats d'appel)

### EXCLU

| Composant | Raison |
|---|---|
| `GET /admin/subscription-plans` | Admin → S22 |
| `GET /admin/subscriptions` | Admin → S22 |
| `POST /admin/subscriptions/{id}/cancel` | Admin → S22 |
| `handle_subscription_event()` (legacy) | S20 déjà documenté (handler actif dans webhook_handlers.py) |
| Webhook handlers | S20 |

---

## Niveau de risque

**MOYEN.**

| Point | Risque | Endpoints |
|---|---|---|
| 3 appels Stripe réseau dans subscribe | MOYEN | subscribe |
| Idempotence checkout via time window | MOYEN | subscribe |
| Cancel Stripe hors transaction | FAIBLE | cancel |
| Session ownership check | FAIBLE | checkout/status |
| Reads simples | TRÈS FAIBLE | plans, me, history |

---

## Résumé ultra court

- **Flow choisi** : 6 endpoints utilisateur subscription — cycle complet (plans, subscribe, checkout/status, me, cancel, history)
- **Tables touchées** : `subscription_plans` (SELECT), `user_subscriptions` (SELECT + UPDATE), `users` (UPDATE stripe_customer_id)
- **Top 3 pièges** :
  1. **`POST /subscribe` fait 3 appels Stripe réseau** en séquence : `get_or_create_customer` → `ensure_subscription_price` → `create_subscription_checkout_session` — tous hors transaction
  2. **Idempotency key avec time window** : `{user_id}_{plan_id}_{5min_bucket}` — empêche les doublons dans une fenêtre de 5 minutes, mais permet de réessayer après
  3. **`POST /cancel` : Stripe hors transaction, DB après** — ordre inversé par rapport aux booking write (S12–S18 où la DB est mise à jour AVANT Stripe). Ici, Stripe est annulé AVANT la mise à jour DB
- **Raison du choix** : ferme l'intégralité du cycle abonnement utilisateur en un seul composant cohérent, les reads triviaux ne justifient pas des slices séparées
