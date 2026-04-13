# SLICE_20_SCOPE.md — Cadrage de la Slice 20
> Basé sur `webhook_handlers.py:584–935` (handler actif), `subscription_routes.py:516–744` (handler legacy),
> `webhook_handlers.py:951–1105` (dispatcher), `payment_routes.py:356–405` (point d'entrée).
> Généré le 2026-04-13.

---

## Flow choisi — Webhook Stripe Subscriptions (6 event types)

### Cible

Documenter le handler `_handle_subscription_event()` dans `webhook_handlers.py` —
la **source de vérité unique** pour toutes les transitions d'état d'abonnement en DB.

Ce handler traite 6 types d'événements Stripe et insère/met à jour la table `user_subscriptions`.

| # | Event type Stripe | Transition DB | Notification |
|---|---|---|---|
| 1 | `checkout.session.completed` (mode=subscription) | INSERT → `active` | subscription_activated |
| 2 | `customer.subscription.created` | INSERT → `active` (fallback) | subscription_activated |
| 3 | `customer.subscription.updated` | UPDATE → `active`/`cancelling`/`cancelled`/`past_due`/`trialing` | cancelling / cancelled |
| 4 | `customer.subscription.deleted` | UPDATE → `cancelled` + `cancelled_at` | subscription_cancelled |
| 5 | `invoice.paid` | UPDATE → `active` + `expires_at` | subscription_renewed |
| 6 | `invoice.payment_failed` | UPDATE → `past_due` | subscription_payment_failed |

---

## Justification du choix

### Pourquoi le webhook et pas le checkout (/subscribe) ?

| Critère | Webhook handlers ✅ | POST /subscribe | GET /subscriptions/me |
|---|---|---|---|
| Source de vérité DB | OUI — crée/met à jour `user_subscriptions` | NON — déclenche Stripe, pas de DB write | NON — lecture seule |
| Fondation pour les autres | OUI — `/me`, `/history`, `/cancel` lisent les données créées par le webhook | Dépend du webhook | Dépend du webhook |
| Intégration existante | Extension naturelle de S16 (même dispatcher) | Nouveau controller | Nouveau controller |
| Complexité métier | ÉLEVÉE (6 events, mapping statuts, idempotence, notifications) | MOYENNE | FAIBLE |
| Structurant ? | ✅ | ❌ Partiel | ❌ |

### Pourquoi MAINTENANT ?

| Critère | Valeur |
|---|---|
| S16 déjà migré | Le dispatcher webhook (`dispatch()`, `_claim_event()`, `_mark_done()`) est déjà documenté pour les paiements |
| S19 StripeService | Les méthodes Stripe réseau sont en place (S19). Le webhook est le "retour" côté Stripe → DB |
| Zéro dépendance non documentée | Les tables `user_subscriptions` et `subscription_plans` existent dans le schéma S16 |
| Bloquant pour tout le reste | Sans webhook fonctionnel, aucun endpoint subscription ne peut être testé |

---

## Fichiers Python analysés

| Fichier | Lignes | Rôle dans cette slice |
|---|---|---|
| `webhook_handlers.py` | 584–935 | **Handler actif** — `_handle_subscription_event()` : 6 branches event |
| `webhook_handlers.py` | 951–977 | Sets de routing : `_SUBSCRIPTION_EVENTS`, `_PAYMENT_EVENTS`, `_CHARGE_EVENTS` |
| `webhook_handlers.py` | 1074–1105 | `_dispatch_subscription()` — sous-dispatcher + `related_id` |
| `webhook_handlers.py` | 78–117 | `_claim_event()` + `_mark_done()` (idempotence — déjà en S16) |
| `webhook_handlers.py` | 938–948 | `_build_benefits_snapshot()` (dupliquée de `subscription_routes.py:112–125`) |
| `webhook_handlers.py` | 63–75 | `_get()`, `_rows()` — utilitaires (déjà en S16) |
| `subscription_routes.py` | 516–744 | **Handler legacy** — `handle_subscription_event()` (même logique, interface différente). **NON APPELÉ** dans le flux production. |
| `payment_routes.py` | 356–405 | Point d'entrée webhook → `webhook_handlers.dispatch()` |

---

## Architecture du dispatch (comment S20 s'intègre dans S16)

```
POST /api/webhook/stripe  (payment_routes.py:357)
  │
  └─→ webhook_handlers.dispatch(pool, event_id, event_type, obj)
        │
        ├─ _claim_event()               ← S16 (idempotence)
        ├─ _resolve_payment_id()         ← S16 (paiements)
        │
        ├─ if event_type in _CHARGE_EVENTS:
        │     _handle_charge_event()     ← S16
        │
        ├─ if event_type in _PAYMENT_EVENTS:
        │     _handle_payment_event()    ← S16
        │
        ├─ if event_type in _SUBSCRIPTION_EVENTS:     ← 🔴 S20 (CETTE SLICE)
        │     _dispatch_subscription()
        │       └─ _handle_subscription_event()       ← 🔴 S20
        │
        ├─ _mark_done()                  ← S16
        └─ Notifications (pending_notifs) ← S16
```

**Point clé** : `checkout.session.completed` est dans **DEUX** sets (`_PAYMENT_EVENTS` ET `_SUBSCRIPTION_EVENTS`).
Le dispatcher appelle les deux handlers. Le routing se fait par `mode` :
- `mode=payment` → `_handle_payment_event` traite, `_handle_subscription_event` retourne (early return)
- `mode=subscription` → `_handle_payment_event` retourne (early return), `_handle_subscription_event` traite

---

## Auth

**AUCUNE** — Le webhook Stripe est authentifié par signature HMAC (`Stripe-Signature` header).
L'endpoint `/api/webhook/stripe` est public (pas de JWT). Déjà documenté en S16.

---

## Dépendances

| Dépendance | Type | Rôle |
|---|---|---|
| Table `user_subscriptions` | DB | INSERT (activation) + UPDATE (transitions) |
| Table `subscription_plans` | DB (SELECT) | Lecture plan pour `benefits_snapshot` |
| Table `stripe_webhook_events` | DB | Idempotence (déjà en S16) |
| `stripe_service.retrieve_subscription()` | Stripe réseau | Lecture `current_period_end` pour `expires_at` (checkout event seulement) |
| `push_service.store_notification()` | Service interne | Notifications post-transition (hors connexion DB principale) |
| `_build_benefits_snapshot()` | Fonction helper | Snapshot des exemptions plan au moment de l'activation |
| `new_id("sub")` | ID generator | Génère les `subscription_id` |
| `_claim_event()` / `_mark_done()` | Idempotence | Déjà en S16 |

---

## Scope explicite — INCLUS vs EXCLU

### INCLUS (Slice 20)

| Composant | Lignes | Détail |
|---|---|---|
| `_handle_subscription_event()` | 586–935 | 6 branches event + helpers internes |
| `_dispatch_subscription()` | 1074–1105 | Sous-dispatcher + `related_id` |
| `_build_benefits_snapshot()` | 938–948 | Helper snapshot (dans webhook_handlers.py) |
| `_SUBSCRIPTION_EVENTS` set | 954–961 | 6 event types |
| Notifications subscription | Inline | 7 patterns de notification |

### EXCLU (hors scope S20)

| Composant | Raison |
|---|---|
| `POST /subscriptions/subscribe` | Endpoint user — Slice 21+ |
| `POST /subscriptions/cancel` | Endpoint user — Slice 21+ |
| `GET /subscriptions/me` / `/history` | Lecture — Slice 21+ |
| `GET /subscription-plans` | Référentiel — Slice 21+ |
| Admin endpoints | Slice 22+ |
| `stripe_service.cancel_subscription()` | Service Stripe — Slice 21+ |
| `stripe_service.ensure_subscription_price()` | Service Stripe — Slice 21+ |
| `pricing_engine._load_subscription_benefits()` | Pricing — indépendant |
| `handle_subscription_event()` (subscription_routes.py) | Handler LEGACY non appelé en production |

---

## Anomalie détectée — Double handler

```
⚠️ ATTENTION : Il existe DEUX handlers subscription dans le codebase Python :

1. webhook_handlers.py:586  → _handle_subscription_event(conn, event_type, obj, pending_notifs)
   → Utilisé en production (appelé par dispatch())
   → Interface : conn DB, pending_notifs list

2. subscription_routes.py:516 → handle_subscription_event(pool, event_type, obj)
   → Handler LEGACY (non appelé nulle part dans le flux actuel)
   → Interface : pool (fait son propre pool.acquire())
   → Pas de système de notifications pending_notifs
   → Logique quasi identique mais avec des divergences mineures

En Java : IGNORER le handler de subscription_routes.py.
Implémenter UNIQUEMENT la version de webhook_handlers.py.
```

---

## Niveau de risque

**MOYEN.**

| Point | Risque | Détail |
|---|---|---|
| 6 event types distincts | MOYEN | Chaque branche a sa propre logique SQL et notification |
| `checkout.session.completed` dual routing | MOYEN | Même event type pour payment ET subscription — discriminant = `mode` |
| `stripe_service.retrieve_subscription()` | FAIBLE | Appel Stripe dans le handler (seul pour checkout event) — try/except protège |
| Idempotence INSERT | FAIBLE | Guard SELECT avant INSERT (`stripe_subscription_id` lookup) |
| Idempotence UPDATE | FAIBLE | Guards `WHERE status NOT IN ('cancelled')` sur 4 branches |
| `benefits_snapshot` JSONB | FAIBLE | Sérialisé via `json.dumps()` — désérialisé par les lecteurs |
| `_build_benefits_snapshot()` dupliquée | FAIBLE | 2 copies (webhook_handlers + subscription_routes) — en Java : une seule |

---

## Résumé ultra court

- **Flow choisi** : `_handle_subscription_event()` — les 6 event types subscription Stripe dans le dispatcher webhook centralisé
- **Tables touchées** : `user_subscriptions` (INSERT + UPDATE), `subscription_plans` (SELECT), `stripe_webhook_events` (S16)
- **Top 3 pièges** :
  1. **`checkout.session.completed` dual routing** : le MÊME event type est dans `_PAYMENT_EVENTS` ET `_SUBSCRIPTION_EVENTS` — le routing se fait par `mode` (payment vs subscription), pas par event type
  2. **Appel Stripe réseau DANS le handler** : `retrieve_subscription()` est appelé DANS la connexion DB (pas hors transaction comme S19) — protégé par try/except mais peut ralentir le webhook
  3. **Handler legacy** : `subscription_routes.py:handle_subscription_event()` est une copie quasi identique NON appelée — ne pas la migrer
- **Raison du choix** : source de vérité unique pour tous les états d'abonnement — fondation obligatoire avant tout endpoint subscription
