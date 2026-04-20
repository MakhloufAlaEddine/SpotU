# SLICE_31_SCOPE.md — Cadrage de la Slice 31
> Basé sur `payment_routes.py:195–351`, `stripe_service.py` (retrieve_checkout_session), `push_service.py`.
> Généré le 2026-04-20.

---

## Flow choisi — Checkout Status (retour Stripe + confirmation front) — 1 endpoint

| # | Méthode | Chemin API | Auth | Complexité | Fichier : Lignes |
|---|---|---|---|---|---|
| 1 | GET | `/api/payments/checkout/status/{session_id}` | **OPTIONNELLE** | ÉLEVÉE | `payment_routes.py` : 195–351 |

---

## Pourquoi cette slice — Justification du choix

| Critère | Justification |
|---|---|
| **Ferme le parcours acheteur front** | Après `POST /bookings/{id}/pay` (S30), le user est redirigé vers Stripe puis revient sur `success_url?session_id={CHECKOUT_SESSION_ID}`. Le front appelle **immédiatement** ce endpoint pour afficher "Paiement confirmé ✅" et les détails. **Sans lui, le front reste bloqué sur un spinner.** |
| **Auth OPTIONNELLE — pattern unique** | Premier endpoint de tout le code Python qui tolère l'absence d'auth. Motivation : le user peut revenir depuis Stripe en session expirée (mobile, device différent). Le `session_id` lui-même est un secret Stripe. **Pattern nouveau à documenter.** |
| **Indépendant du webhook** | Fait un **upsert best-effort** : interroge Stripe, lit `session.payment_status` + `session.status`, puis flip les statuts DB en fonction. Si le webhook est plus lent (ou pas migré encore), ce endpoint fait quand même l'update. **Permet au front de vivre sans webhook migré.** |
| **Logique transitions complète** | Couvre les 3 transitions critiques : `requires_authorization → authorized` (manual_approval), `requires_authorization → captured` (instant_booking), `authorized → cancelled` (session Stripe expirée). |
| **Notifications push finales** | Envoie 2 push (payer + receiver) quand un instant_booking est confirmé — closant le loop utilisateur. |
| **Périmètre court** | 1 endpoint, ~160 lignes Python. Compact, testable indépendamment. Suit la règle "slice précise". |
| **Fallback Stripe down** | Si `stripe_service.retrieve_checkout_session` throw → retour d'un état "unknown" sans erreur 500. Robustesse front. |

### Alternatives écartées

| Alternative | Pourquoi non |
|---|---|
| **Webhook Stripe complet** (`POST /webhook/stripe` + `webhook_handlers.dispatch`) | **Trop gros pour une slice**. Le dispatcher couvre : `checkout.session.completed`, `payment_intent.succeeded/failed/canceled/requires_action`, `charge.refunded`, `refund.updated`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`. Au moins **10+ events** × logique d'idempotence `stripe_webhook_events` + transitions subscriptions = 500+ lignes. → **Slice dédiée ultérieure** (ex S32 ou S33). |
| **Bundle checkout/status + webhook** | Idem. Le webhook ferme le domaine serveur-à-serveur, pas le parcours front. |
| **GET /payments/me + /payments/{id}** | Lectures historique — utile pour "Mes paiements" mais pas sur le chemin critique post-paiement. Le user revient d'abord sur `/payment-success`. Slice ultérieure. |
| **Chat / WebSocket** | Hors domaine paiement. Peut attendre. |
| **Booking lifecycle (accept/refuse/cancel)** | Côté owner/support, pas acheteur. Pas sur le chemin critique "je viens de payer". |

---

## Fichiers Python analysés

| Fichier | Lignes | Rôle |
|---|---|---|
| `payment_routes.py` | 195–351 | `GET /payments/checkout/status/{session_id}` |
| `payment_routes.py` | 32–36 | `_deserialize()` (pas utilisé ici mais présent dans le module) |
| `stripe_service.py` | `retrieve_checkout_session(session_id)` | Appel Stripe externe |
| `push_service.py` | `send_push_to_user` | Notifications push await (pas fire-and-forget ici — voir BR-31.05) |
| `auth_utils.py` | `require_auth(request, pool)` | Utilisé dans try/except (optionnel) |
| `database.py` | `get_pool`, `row_to_dict` | Accès DB |

---

## Dépendances

| Dépendance | Type | Obligatoire | Commentaire |
|---|---|---|---|
| Table `payments` | DB SELECT + UPDATE | oui | Lookup par `stripe_checkout_session_id` OR `stripe_payment_intent_id` |
| Table `bookings` | DB SELECT + UPDATE | oui | Guard `status` + flip `status/payment_status` |
| Table `services` | DB SELECT `title` | oui | Uniquement si branche push (instant_booking captured) |
| Table `users` | (pas SELECT direct) | — | Push service appelé par `user_id` directement |
| `stripe_service.retrieve_checkout_session(session_id)` | Stripe API | oui | **Try/except silencieux** — retour fallback si échec |
| `push_service.send_push_to_user` | Service interne | non | Uniquement si branche instant_booking captured |
| `require_auth` | Auth | **non** | Auth tentée en try/except, pas bloquante |

> ⚠️ Aucune dépendance sur les slices de lecture `/payments/me` ou `/payments/{id}`. Endpoint **auto-contenu**.

---

## Niveau de risque

**ÉLEVÉ.**

| Point | Risque | Impact Java |
|---|---|---|
| **Auth optionnelle** (try/except) | MOYEN | Java : SecurityConfig doit permettre ce endpoint en `permitAll()`. Lire le token si présent (pour logging/audit) mais ne pas bloquer. |
| **Lookup par `session_id` OR `payment_intent_id`** | MOYEN | Deux colonnes distinctes interrogées dans le même WHERE. Java : `WHERE stripe_checkout_session_id = :id OR stripe_payment_intent_id = :id LIMIT 1`. |
| **Logique de transitions complexe** (3 branches × 2 scenarios) | **ÉLEVÉ** | Matrice `session.status` × `session.payment_status` × `db_status` × `booking.status` → 6+ chemins distincts. Documentation exhaustive. |
| **Push notifications sync (pas fire-and-forget)** | MOYEN | Au contraire du reste du code, ici `await send_push_to_user(...)` est utilisé. Si le push échoue, **l'endpoint échoue** (ou au moins bloque). Compat : garder le comportement sync. |
| **Fallback "unknown" silencieux** | FAIBLE | Si Stripe throw → retour JSON avec `"status": "unknown"`. Pas de 500. Java doit reproduire ce fallback. |
| **`amount` calculé à partir de `session.amount_total`** | FAIBLE | Fallback sur `payment.payer_total_amount` si `session.amount_total` absent. Division par 100 (conversion cents → euros). |
| **`currency` lowercase Stripe → DB uppercase** | FAIBLE | `session.currency or payment.currency` — potentiellement lowercase ('eur') venant de Stripe. Réponse retourne tel quel. |
| **Race condition avec webhook** | MOYEN | Si le webhook Stripe arrive **pendant** qu'on est dans cet endpoint, deux UPDATE peuvent se superposer. Le garde `WHERE status NOT IN ('confirmed','refused','cancelled','expired')` empêche la régression mais pas la double-notif. **À documenter.** |

---

## Résumé ultra court

- **Flow choisi** : `GET /api/payments/checkout/status/{session_id}` — 1 endpoint (post-Stripe-redirect confirmation)
- **Tables touchées** : `payments` (SELECT + UPDATE status/updated_at), `bookings` (SELECT status + UPDATE status/payment_status/updated_at), `services` (SELECT title pour push)
- **Top 3 pièges** :
  1. **Auth OPTIONNELLE via try/except** — Java doit permettre appel sans token ET tenter de lire le token si présent (contrairement à tous les autres endpoints). Le `session_id` sert de secret.
  2. **Matrice de transitions à 6 branches** (`s_status × stripe_ps × db_status × booking.status`) — **aucune branche ne doit être oubliée**. Ordre exact `if/elif/elif` important.
  3. **Push envoyés en `await` (sync, pas fire-and-forget)** — contraire au pattern S29/S30. Si push fail → peut faire remonter l'erreur. Java doit reproduire à l'identique (pas de `@Async`).
- **Raison du choix** : 1 endpoint, auto-suffisant, ferme le **parcours acheteur front** côté UI. Premier pattern "auth optionnelle" à documenter. Indépendant du webhook (qui reste une slice dédiée ultérieure trop grosse pour être bundlée). Sans ce endpoint, le front reste bloqué sur un spinner après retour Stripe.
