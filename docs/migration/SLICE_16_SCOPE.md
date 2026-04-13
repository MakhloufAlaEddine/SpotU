# SLICE_16_SCOPE.md — Cadrage de la Slice 16 — Première Slice Stripe
> Sources : `payment_routes.py:354–405`, `webhook_handlers.py:1–583`, `webhook_handlers.py:951–1071`.
> `stripe_service.py:240–248` (parse_webhook_event).
> Généré le 2026-02-XX.

---

## Justification du choix — `POST /webhook/stripe` (paiements uniquement)

### Pourquoi le webhook en premier ?

| Critère | Valeur |
|---|---|
| **Fondation obligatoire** | Sans webhook, toutes les transitions Stripe des Slices 12–15 restent des stubs DB incomplets |
| **Source de vérité unique** | Le code Python est explicite : `"Les statuts DB sont TOUJOURS mis à jour DEPUIS les webhooks Stripe"` (webhook_handlers.py:25) |
| **Critique pour idempotence** | La table `stripe_webhook_events` protège contre tous les doubles traitements Stripe |
| **`stripe_charge_id` stocké ici** | L'event `payment_intent.succeeded` stocke `latest_charge` → nécessaire pour les refunds de la Slice 15 |
| **Bloquant pour le reste** | Checkout session create (Slice 17+) n'a de valeur que si le webhook confirme le paiement |
| **Scope contrôlé** | Abonnements exclus → scope limité aux 7 event types paiements |

### Comparaison des candidats Stripe

| Endpoint / Flow | Dépend de | Complexité | Verdict |
|---|---|---|---|
| `POST /webhook/stripe` (paiements) ✅ | Rien | MOYEN | **Slice 16** |
| `POST /payments/checkout/session` | Webhook pour confirmer | FAIBLE | Slice 17 |
| `GET /payments/checkout/status/{id}` | Checkout session | MOYEN | Slice 17 |
| `POST /webhook/stripe` (abonnements) | Base webhook | ÉLEVÉ | Slice 18 |
| `PATCH /payments/{id}/stripe` | Usage interne | FAIBLE | Slice 17 |

---

## Périmètre de la Slice 16 — Événements inclus

### Endpoint

| Méthode | Chemin Python | Chemin Java | Fichier | Lignes |
|---|---|---|---|---|
| POST | `/api/webhook/stripe` | `/api/webhook/stripe` | `payment_routes.py` | 356–405 |

### Handlers inclus (webhook_handlers.py)

| Fonction | Lignes | Rôle |
|---|---|---|
| `dispatch()` | 979–1071 | Dispatcher principal |
| `_claim_event()` | 80–101 | Idempotence — INSERT ON CONFLICT |
| `_mark_done()` | 104–117 | Mise à jour statut event |
| `_resolve_payment_id()` | 122–180 | Résolution payment_id (4 fallbacks) |
| `_handle_payment_event()` | 185–453 | Transitions paiements transactionnels |
| `_handle_charge_event()` | 458–581 | Remboursements |

### Événements paiements inclus

| Event Stripe | Transition DB | Notification |
|---|---|---|
| `checkout.session.completed` (unpaid + awaiting_payment) | `payments` → captured ; `bookings` → confirmed | payer + receiver |
| `checkout.session.completed` (unpaid + requested) | `payments` → authorized | receiver |
| `checkout.session.completed` (paid) | `payments` → captured ; `bookings` → confirmed | payer + receiver |
| `payment_intent.amount_capturable_updated` | `payments` → authorized | receiver |
| `payment_intent.succeeded` | `payments` → captured + `stripe_charge_id` ; `bookings` → confirmed | payer + receiver |
| `payment_intent.payment_failed` | `payments` → failed | payer |
| `payment_intent.canceled` | `payments` → cancelled | Aucune |
| `charge.refunded` (full) | `payments` → refunded + `refund_amount` | payer |
| `charge.refunded` (partial) | `payments` → partially_refunded + `refund_amount` | payer |
| `refund.updated` | `payments.refund_status` sync | Aucune |

### Événements abonnements EXCLUS (→ Slice 18)

```
customer.subscription.created / updated / deleted
checkout.session.completed (mode=subscription)
invoice.paid / invoice.payment_failed
```

---

## Auth

```
AUCUNE authentification utilisateur.
Le webhook est appelé directement par Stripe (serveur → serveur).
La seule "auth" est la vérification de signature HMAC (Stripe-Signature header).
```

---

## Dépendances

| Dépendance | Type | Rôle |
|---|---|---|
| `stripe_webhook_events` | Table DB | Idempotence PK |
| `payments` | Table DB | Transitions statut |
| `bookings` | Table DB | Sync status + payment_status |
| `STRIPE_WEBHOOK_SECRET` | Env var | Vérification signature HMAC |
| `stripe.Webhook.construct_event()` | SDK Stripe | Parsing + vérification signature |
| `push_service.store_notification()` | Service interne | Notifications post-webhook |
| ~~`user_subscriptions`~~ | **EXCLU Slice 18** | |
| ~~`subscription_plans`~~ | **EXCLU Slice 18** | |

---

## Niveau de risque

**MOYEN-ÉLEVÉ.**

| Point | Risque |
|---|---|
| Body raw bytes OBLIGATOIRE | Spring Boot auto-parse JSON détruirait la signature HMAC |
| Toujours retourner 200 | Ne jamais propager d'exception → Stripe réessaie si non-200 |
| `checkout.session.completed` dual routing | mode=payment vs mode=subscription — ne pas confondre |
| `_claim_event` atomicité | INSERT ON CONFLICT doit être atomique — pas de UPSERT simple |
| `stripe_charge_id` dans `payment_intent.succeeded` | Extraire `latest_charge` (format `ch_...`), sinon les refunds sont impossibles |
| Notifications hors transaction | Envoyées APRÈS conn.release(), pas dans la transaction webhook |
| Mode dev sans secret | `STRIPE_WEBHOOK_SECRET` vide → parse JSON brut (jamais en prod) |

---

## Pièges (top 7)

| # | Piège | Détail |
|---|---|---|
| P1 | **Body raw bytes** | `HttpServletRequest.getInputStream()` avant tout parsing JSON. Configurer Spring pour ne pas auto-parse le body sur `/api/webhook/stripe`. |
| P2 | **200 inconditionnel** | Même en cas d'exception dans le handler, retourner `{"received": true}`. Le log est suffisant, Stripe ne doit pas réessayer un event déjà en erreur applicative. |
| P3 | **`checkout.session.completed` dual** | `mode=payment` → `_handle_payment_event` ; `mode=subscription` → `_dispatch_subscription`. Le mode doit être lu AVANT le routing. |
| P4 | **`_resolve_payment_id` 4 fallbacks** | `metadata.payment_id` → `stripe_payment_intent_id` → `stripe_checkout_session_id` → `stripe_charge_id`. Ne pas simplifier : tous les fallbacks couvrent des scénarios réels. |
| P5 | **`latest_charge` dans `payment_intent.succeeded`** | Vérifier `isinstance(charge_id, str) and charge_id.startswith("ch_")` avant de stocker. Si absent → mettre à jour captured sans `stripe_charge_id`. |
| P6 | **Guards anti-régression** | `WHERE status NOT IN ('captured','refunded','cancelled')` sur chaque UPDATE payment. Empêche de revenir en arrière en cas de double event. |
| P7 | **Notifications hors connexion DB** | `store_notification` est appelé dans une boucle APRÈS le bloc `async with pool.acquire()`. En Java, utiliser `@Async` ou thread séparé pour les notifications. |
