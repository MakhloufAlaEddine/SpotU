# SLICE_32_SCOPE.md — Cadrage de la Slice 32
> Basé sur `payment_routes.py:356–405`, `webhook_handlers.py:1–117, 979–1071`, `stripe_service.py:242–248`.
> Généré le 2026-04-20.

---

## Flow choisi — Webhook Infrastructure (signature + idempotence + dispatcher squelette) — 1 endpoint

| # | Méthode | Chemin API | Auth | Complexité | Fichier : Lignes |
|---|---|---|---|---|---|
| 1 | POST | `/api/webhook/stripe` | **PAS d'auth utilisateur** (signature Stripe) | ÉLEVÉE | `payment_routes.py` : 356–405 |

### Périmètre fonctionnel exact
La slice couvre :
1. **Endpoint REST** : réception du webhook avec **raw body** + header `Stripe-Signature`
2. **Vérification de signature** Stripe (`stripe.Webhook.construct_event`) — fallback JSON brut si `STRIPE_WEBHOOK_SECRET` absent (mode dev)
3. **Extraction `event_id`, `event_type`, `obj` data**
4. **Idempotence** : `_claim_event` + `_mark_done` via table `stripe_webhook_events` (INSERT ... ON CONFLICT DO NOTHING)
5. **Dispatcher squelette** : structure `dispatch()` qui tente le routage mais avec **handlers laissés en STUB no-op** (renvoient `pending_notifs=[]` immédiatement)
6. **Always-200 protocol** : Stripe doit recevoir 200 sauf en cas de body/signature invalide (400). Les exceptions handlers sont catchées + log + `_mark_done(error)` mais pas re-raise.
7. **Notification envoi post-connection** : boucle `pending_notifs` exécutée après `pool.release` (ici toujours vide vu les stubs).

### Ce qui est explicitement HORS périmètre Slice 32
- `_handle_payment_event` (185–456) → **Slice 33** (handlers paiement)
- `_handle_charge_event` (458–584) → Slice 34 (refunds)
- `_handle_subscription_event` (586–977) → Slice 35 (abonnements)
- `_dispatch_subscription` (1074–1104) → Slice 35
- `_resolve_payment_id` (122–183) → **Slice 33** (utilisé uniquement par les handlers paiement)
- `push_service.store_notification` → Slice 33+ (uniquement appelé en post-traitement quand handlers populent `pending_notifs`)

> **Justification du split** : les sets `_PAYMENT_EVENTS`, `_CHARGE_EVENTS`, `_SUBSCRIPTION_EVENTS` peuvent être déclarés mais initialisés à `set()` vide en Slice 32. La structure if/if/if du dispatch reste mais ne match aucun event → tous les events partent en `_mark_done(success)` après idempotence sans transition métier.

---

## Pourquoi cette slice — Justification du choix

| Critère | Justification |
|---|---|
| **Sécurise l'infra avant tout** | Sans signature verification + idempotence, les slices handlers (33/34/35) seraient bâties sur du sable. **Toute la sécurité du webhook repose sur ces 3 patterns**. Les migrer en premier protège même si les handlers ne sont pas encore migrés. |
| **Mini-slice véritablement testable** | 1 endpoint + 1 helper signature + 2 fonctions idempotence = ~150 lignes Java. Compact. **Auto-suffisant** : Stripe peut envoyer ses events, ils sont stockés idempotents en DB, marqués `success` (handlers stub), Stripe arrête de retry. |
| **Pas de logique métier** | Aucune transition `payments` ni `bookings`. La complexité applicative est repoussée aux slices suivantes. **Risque métier minimal**. |
| **Pattern raw body inédit** | FastAPI `await request.body()` → `bytes` brut. Java doit lire `HttpServletRequest.getInputStream()` AVANT toute désérialisation Spring (sinon Jackson consomme le stream et la signature échoue). **Pattern structurant à documenter avant les handlers.** |
| **Mode dev vs prod** | Si `STRIPE_WEBHOOK_SECRET` absent → parse JSON brut (mode test). Sinon → vérification signature stricte. Rare configuration "fail-soft" à reproduire bit-pour-bit. |
| **Always-200 protocol Stripe** | Le webhook DOIT répondre 200 pour signaler l'idempotence à Stripe. Si on retourne 4xx/5xx, Stripe retry exponentiel (sauf 400 signature invalide qui est un retry-stop). Pattern critique. |

### Alternatives écartées

| Alternative | Pourquoi non |
|---|---|
| **Webhook complet (infra + handlers)** | Trop gros : ~1100 lignes de webhook_handlers.py couvrant payment/charge/subscription/invoice. Contre la règle "slices précises". |
| **Bundle infra + payment handlers (sans charge/subscription)** | Mieux mais quand même ~700 lignes total. La Slice 33 dédiée payment_intent.* + checkout.session est plus testable seule. |
| **Booking lifecycle (accept/refuse/cancel)** | N'est pas event-driven. Hors domaine async paiement. Plus tard. |
| **Payment reads (`/payments/me`)** | Pas urgent pour l'event flow. Pas sur le chemin critique post-paiement. |

---

## Fichiers Python analysés

| Fichier | Lignes | Rôle |
|---|---|---|
| `payment_routes.py` | 28–29 | Constantes `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET` |
| `payment_routes.py` | 356–405 | Endpoint `POST /webhook/stripe` |
| `stripe_service.py` | 242–248 | `parse_webhook_event(body, sig) → stripe.Event` |
| `webhook_handlers.py` | 65–75 | `_get(obj, key, default)` + `_rows(result)` (helpers) |
| `webhook_handlers.py` | 80–101 | `_claim_event(conn, event_id, event_type) → bool` |
| `webhook_handlers.py` | 104–117 | `_mark_done(conn, event_id, status, related_id, error_message)` |
| `webhook_handlers.py` | 979–1071 | `dispatch(pool, event_id, event_type, obj) → dict` |

**Hors périmètre mais cités** :
- `webhook_handlers.py:122–183` `_resolve_payment_id` (utilisé par dispatch — voir §Stub)
- Sets `_PAYMENT_EVENTS`, `_CHARGE_EVENTS`, `_SUBSCRIPTION_EVENTS` (déclarés ailleurs dans le module)

---

## Dépendances

| Dépendance | Type | Obligatoire | Commentaire |
|---|---|---|---|
| Table `stripe_webhook_events` | DB INSERT/UPDATE | oui | PRIMARY KEY sur `event_id` pour idempotence atomique |
| `stripe.Webhook.construct_event(body, sig, secret)` | Stripe SDK | oui | Vérifie HMAC-SHA256 + timestamp |
| `STRIPE_WEBHOOK_SECRET` env | Config | non (fallback dev) | `whsec_...` pour signature ; absent → mode dev no-sig |
| `pool.acquire()` (asyncpg) | DB pool | oui | Connection unique pour la transaction idempotence |
| Logger `webhook_handlers` | Logging | oui | Traces `Webhook reçu`, `Webhook doublon ignoré`, `Erreur handler webhook`, `Notification envoyée` |
| Sets `_PAYMENT_EVENTS / _CHARGE_EVENTS / _SUBSCRIPTION_EVENTS` | Constantes | oui | Initialisés vides en S32 — populés en S33/34/35 |

---

## Niveau de risque

**ÉLEVÉ.**

| Point | Risque | Impact Java |
|---|---|---|
| **Raw body avant parsing** | TRÈS ÉLEVÉ | Spring désérialise par défaut le body. Doit utiliser `byte[]` ou `HttpServletRequest.getInputStream()` directement avant que Jackson n'intercepte. Sinon signature verification fail systématiquement. |
| **Header `Stripe-Signature` exact** | MOYEN | Cas-sensible. Doit être lu via `request.getHeader("Stripe-Signature")` (pas variations). |
| **Idempotence atomique INSERT ON CONFLICT** | ÉLEVÉ | `INSERT ... ON CONFLICT (event_id) DO NOTHING` + check du command tag `"INSERT 0 1"` vs `"INSERT 0 0"`. Java JPA n'expose pas le tag asyncpg → utiliser `RETURNING xmin` ou `WHERE NOT EXISTS` ou mesurer affected_rows. |
| **Always-200 sauf 400 signature/body** | ÉLEVÉ | Catch global toutes exceptions handlers, log, retourner 200. Si 5xx ou exception non-catchée → Stripe retry indéfiniment (mauvais UX + DB spam). |
| **`pending_notifs` post-pool-release** | MOYEN | Le code Python relâche le pool puis itère et envoie les notifs. Java : faire pareil — sortir du `@Transactional` avant les push (post-commit listener OK). |
| **Mode dev sans secret** | FAIBLE | `if STRIPE_WEBHOOK_SECRET: parse_signed; else: json.loads(body)`. Java : @Value config nullable + branchement `if (secret != null)`. |

---

## Résumé ultra court

- **Flow choisi** : `POST /api/webhook/stripe` — endpoint webhook Stripe + signature verification + idempotence + dispatcher squelette (handlers stub vides). 1 endpoint.
- **Tables touchées** : `stripe_webhook_events` (INSERT ON CONFLICT DO NOTHING + UPDATE status='success'/'error'/'ignored'). **Aucune autre table** en Slice 32.
- **Top 3 pièges** :
  1. **Raw body obligatoire pour signature** : Java doit lire `byte[]` AVANT que Spring ne désérialise. Utiliser `@RequestBody byte[]` ou `HttpServletRequest.getInputStream()` direct. Sinon signature fail.
  2. **Always-200 sauf 400 signature/body** : tout autre erreur (DB down, exception handler) → 200 + log + `_mark_done(error)`. **Ne PAS re-raise.** Sinon Stripe retry exponentiel infini.
  3. **`INSERT ON CONFLICT DO NOTHING` + détection insertion réelle** : asyncpg parse le command tag `"INSERT 0 1"` vs `"INSERT 0 0"`. Java doit utiliser une technique équivalente (`affected_rows == 1` ou `RETURNING event_id` avec `Optional.isPresent()`).
- **Raison du choix** : sécurise toute la chaîne webhook avant les handlers métier. Mini-slice auto-suffisante (~150 lignes Java) qui rend Stripe content (200) et stocke les events idempotents même si les handlers sont stub. Permet aux Slices 33/34/35 (handlers payment/charge/subscription) de se concentrer sur la logique métier sans re-toucher à l'infrastructure. **Le webhook devient migrable progressivement.**
