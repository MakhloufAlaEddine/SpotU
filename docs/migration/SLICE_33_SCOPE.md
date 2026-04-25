# SLICE_33_SCOPE.md — Cadrage de la Slice 33
> Basé sur `webhook_handlers.py:122–180, 185–453, 964–970, 1007–1027`.
> Généré le 2026-04-25.

---

## Flow choisi — Stripe Webhook **Payment Handlers** (`_handle_payment_event` complet + `_resolve_payment_id` complet) — 0 endpoint nouveau

S33 ne crée **pas** de nouvel endpoint REST. Elle **populate** la slice infrastructure S32 :
- Active le set `_PAYMENT_EVENTS` (5 events)
- Implémente `_handle_payment_event` (transitions `payments`/`bookings` + notifications)
- Implémente `_resolve_payment_id` (4 stratégies de lookup)
- Active la branche `if event_type in _PAYMENT_EVENTS:` du dispatcher

| # | Méthode | Chemin API | Auth | Complexité | Fichier : Lignes |
|---|---|---|---|---|---|
| — | (aucun nouvel endpoint) | `POST /api/webhook/stripe` (S32 réutilisé) | signature HMAC | **TRÈS ÉLEVÉE** | `webhook_handlers.py` : 122–180, 185–453 |

### Périmètre fonctionnel exact

**5 events Stripe traités** (set `_PAYMENT_EVENTS`, lignes 964–970) :

| Event Stripe | Transition `payments` | Transition `bookings` | Notification |
|---|---|---|---|
| `checkout.session.completed` (mode=payment, ps=unpaid, booking.status=`awaiting_payment`) | → `captured` | → `confirmed` + `payment_status=paid` | 2 notifs `booking_confirmed` (payer + receiver) |
| `checkout.session.completed` (mode=payment, ps=unpaid, booking.status≠`awaiting_payment`) | → `authorized` | aucune | 1 notif `payment_authorized` (receiver) |
| `checkout.session.completed` (mode=payment, ps=paid) | → `captured` | → `confirmed` + `payment_status=paid` | 2 notifs `booking_confirmed` |
| `payment_intent.amount_capturable_updated` | → `authorized` | aucune | 1 notif `payment_authorized` (receiver) |
| `payment_intent.succeeded` | → `captured` (+ `stripe_charge_id` si présent) | → `confirmed` + `payment_status=paid` | 2 notifs `booking_confirmed` |
| `payment_intent.payment_failed` | → `failed` | aucune | 1 notif `payment_failed` (payer) |
| `payment_intent.canceled` | → `cancelled` | aucune | **pas de notif** (booking déjà notifié via refuse/cancel) |

> `checkout.session.completed` (mode=subscription) → renvoie immédiatement (Slice 35).

**`_resolve_payment_id` — 4 stratégies de lookup** (lignes 122–180) :
1. `metadata.payment_id` (le plus fiable, set lors du checkout S30)
2. `stripe_payment_intent_id` (lookup direct sur `payments` table)
3. `stripe_checkout_session_id` (fallback checkout)
4. `stripe_charge_id` (fallback charge — utile en S34, mais code S33 doit le porter pour cohérence du helper)

**Helper réutilisé en S34/S35** : `_resolve_payment_id` est partagé. **Implémenté intégralement en S33** (S34 utilise déjà cette fonction).

### Ce qui est explicitement HORS périmètre Slice 33
- `_handle_charge_event` (lignes 458–584, refunds) → **Slice 34**
- `_handle_subscription_event` + `_dispatch_subscription` (lignes 586–977, 1074–1104) → **Slice 35**
- Set `_CHARGE_EVENTS` populated → S34
- Set `_SUBSCRIPTION_EVENTS` populated → S35
- Endpoint `POST /api/webhook/stripe` lui-même → déjà migré en S32

> Justification du split : S33 couvre le parcours buyer-paie heureux + échec/annulation (5 events). S34 ouvre les refunds (2 events). S35 ouvre les abonnements (6 events). Découpage par domaine métier, pas par event Stripe brut.

---

## Pourquoi cette slice — Justification du choix

| Critère | Justification |
|---|---|
| **Débloque le parcours buyer end-to-end en Java** | S30 (création booking + Stripe checkout) + S31 (status check après redirect) + S32 (webhook infra) sont migrés. Sans S33, les `payments` et `bookings` ne **transitionnent jamais** vers `captured`/`confirmed` côté Java. **Le buyer paie mais le statut reste bloqué**. S33 ferme ce trou. |
| **Mini-slice avec contour clair** | 5 events liés au domaine "paiement transactionnel". Refunds (2) et abonnements (6) sont volontairement exclus. ~270 lignes Python à porter (handler + resolver). Auto-suffisant. |
| **Indépendance du booking lifecycle** | S33 ne touche pas aux endpoints accept/refuse/cancel. Elle ne fait que **réagir** aux events Stripe. Les routes booking peuvent être migrées séparément (S36+). |
| **Contrats DB stricts à reproduire** | Tous les UPDATE utilisent `WHERE status NOT IN (...)` (idempotence). Tous les notifs vérifient `_rows(res) > 0`. **Patterns à porter bit-pour-bit en JPA** sinon double-notification possible. |
| **Source de vérité = webhook** | La doc Python est explicite : `payments.status` est mis à jour DEPUIS Stripe, pas déduit. Java doit respecter ce contrat sinon désync DB ↔ Stripe. |
| **Validation possible sans handlers refund/sub** | Stripe peut envoyer un test `payment_intent.succeeded` → on peut valider la chaîne complète sans toucher S34/S35. |

### Alternatives écartées

| Alternative | Pourquoi non |
|---|---|
| **Tout `_handle_payment_event` + `_handle_charge_event` + `_handle_subscription_event`** | Trop gros (~1100 lignes). Casse la règle slice-précise. Risque métier élevé : refunds + subscriptions ont leur propre lifecycle. |
| **Seulement `payment_intent.succeeded` (1 event)** | Insuffisant : `failed` et `canceled` doivent être dans la même slice pour fermer le lifecycle paiement. Et `checkout.session.completed` est inévitable car Stripe l'envoie systématiquement. |
| **Bundle paiements + accept booking endpoint** | Mélange 2 domaines (REST sync vs webhook async). Le booking accept fait son propre Stripe capture côté API directe — c'est une slice booking dédiée. |
| **Reporter `_resolve_payment_id` à plus tard** | Impossible : sans resolver, `_handle_payment_event` ne sait pas quel `payment_id` cibler. Helper indissociable. |

---

## Fichiers Python analysés

| Fichier | Lignes | Rôle |
|---|---|---|
| `webhook_handlers.py` | 65–75 | Helpers `_get`, `_rows` (déjà portés en S32) |
| `webhook_handlers.py` | 122–180 | `_resolve_payment_id` complet (4 stratégies) — **PORTER en S33** |
| `webhook_handlers.py` | 185–453 | `_handle_payment_event` (5 branches if/elif) — **PORTER en S33** |
| `webhook_handlers.py` | 964–970 | Set `_PAYMENT_EVENTS` (5 events) — **POPULATE en S33** |
| `webhook_handlers.py` | 1007–1027 | Branche dispatcher `if event_type in _PAYMENT_EVENTS:` — **ACTIVER en S33** |
| `push_service.py` | 62–88 | `store_notification` (notifications WebSocket + DB) — **PORTER ou stub en S33** |

**Hors périmètre mais cités** :
- `webhook_handlers.py:458–584` `_handle_charge_event` (S34)
- `webhook_handlers.py:586–977` `_handle_subscription_event` (S35)

---

## Dépendances

| Dépendance | Type | Obligatoire | Commentaire |
|---|---|---|---|
| Slice 32 | Infra | **OUI** | Endpoint `/api/webhook/stripe`, signature, idempotence, dispatcher squelette |
| Slice 30 | Métier | **OUI** | C'est S30 qui crée les `payments` avec `stripe_checkout_session_id`, `stripe_payment_intent_id`, `metadata.payment_id`. Sans S30, S33 n'a rien à transitionner. |
| Table `payments` | DB UPDATE | OUI | `status`, `stripe_charge_id`, `updated_at` |
| Table `bookings` | DB UPDATE | OUI | `status`, `payment_status`, `updated_at` |
| Table `services` | DB SELECT | OUI | `title` (pour le body de notification) |
| Table `notifications` | DB INSERT | OUI | Via `store_notification` |
| `chat_manager.notif_manager` | WebSocket | OUI | Diffusion temps réel notif |
| Logger `webhook_handlers` | Logging | OUI | Trace `Payment event traité : type=... | payment=... | booking=...` |

---

## Niveau de risque

**TRÈS ÉLEVÉ.**

| Point | Risque | Impact Java |
|---|---|---|
| **Idempotence guards `WHERE status NOT IN (...)`** | TRÈS ÉLEVÉ | Si oublié → double-transition possible (ex: `failed` → `captured` après retry Stripe). Toutes les UPDATE doivent porter le guard exact. |
| **Notification émise UNIQUEMENT si `rows_updated > 0`** | TRÈS ÉLEVÉ | Sinon : doublon de notif à chaque retry Stripe. Java doit récupérer le `int` retour de `@Modifying @Query` et tester `> 0` AVANT d'append à `pendingNotifs`. |
| **`checkout.session.completed` 3 branches (unpaid+awaiting / unpaid+other / paid)** | ÉLEVÉ | Routage par `obj.payment_status` + lookup `bookings.status='awaiting_payment'`. Erreur de routage → mauvais statut + mauvaises notifs. |
| **`_resolve_payment_id` 4 stratégies + ordre de priorité** | ÉLEVÉ | Si l'ordre est inversé → match incorrect (ex: `metadata.payment_id` doit gagner sur `stripe_payment_intent_id`). |
| **Transactions atomiques `payments` + `bookings`** | ÉLEVÉ | Le code Python utilise `async with conn.transaction():` pour grouper UPDATE payments + bookings. Java : `@Transactional` autour de la branche. |
| **Fallback `latest_charge` pour `payment_intent.succeeded`** | MOYEN | Si présent → UPDATE additionnel `stripe_charge_id`. Si absent → UPDATE simple status='captured'. Branchement à reproduire. |
| **JOIN services pour le title de notification** | MOYEN | `LEFT JOIN bookings → services` ; si pas trouvé → fallback `"votre prestation"`. Préserver le fallback exact. |
| **`pending_notifs` collecté DANS le pool, envoyé HORS du pool** | MOYEN | Pattern S32 hérité. Java : collecter dans la transaction, exécuter `storeNotification` post-commit. |
| **Aucune notification pour `payment_intent.canceled`** | FAIBLE | Asymétrie volontaire (booking déjà notifié). Java : ne **pas** ajouter de notif "par symétrie". |
| **Logs format `|` séparateur exact** | FAIBLE | `log.info("Payment event traité : type=%s | payment=%s | booking=%s", ...)`. SLF4J `{}`. |

---

## Résumé ultra court

- **Events choisis (5)** :
  1. `checkout.session.completed` (mode=payment seulement — 3 sous-branches selon `payment_status` + `bookings.status`)
  2. `payment_intent.amount_capturable_updated`
  3. `payment_intent.succeeded`
  4. `payment_intent.payment_failed`
  5. `payment_intent.canceled`

- **Tables touchées** :
  - **WRITE** : `payments` (status, stripe_charge_id), `bookings` (status, payment_status), `notifications` (via `store_notification`)
  - **READ** : `payments` (payer_user_id, receiver_user_id), `bookings` (status), `services` (title via JOIN)
  - **PAS touchées** : `subscriptions`, `refunds`, `disputes`, autres tables

- **Top 3 pièges** :
  1. **Idempotence guards `WHERE status NOT IN (...)`** : à porter bit-pour-bit sur chaque UPDATE. Sans cela, Stripe retry → double-transition. Le retour `int` de `@Modifying` doit être lu et `> 0` testé AVANT d'émettre la notification (sinon doublons de notifs).
  2. **`checkout.session.completed` triple branche** : `mode=payment` + `ps=unpaid` + `bookings.status='awaiting_payment'` → captured. `mode=payment` + `ps=unpaid` + autre → authorized. `mode=payment` + `ps=paid` → captured. **3 chemins distincts**, ne pas fusionner.
  3. **`_resolve_payment_id` ordre lookup** : `metadata.payment_id` (priorité 1) > `stripe_payment_intent_id` > `stripe_checkout_session_id` > `stripe_charge_id`. **Court-circuit early return** dès qu'un match est trouvé. Ne jamais essayer toutes les stratégies en parallèle.

- **Raison du choix** : Slice 33 ferme le parcours buyer-paiement bout-en-bout côté Java. C'est l'aboutissement de S30 (création booking+checkout) + S31 (status check) + S32 (infra webhook). Sans S33, les `payments` Java ne sortent jamais de l'état `pending`. Périmètre serré : 5 events, 1 handler, 1 resolver. Refunds (S34) et subscriptions (S35) restent isolés. **Le webhook devient enfin "vivant" pour les paiements transactionnels**.
