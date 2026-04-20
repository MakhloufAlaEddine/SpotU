# SLICE_30_SCOPE.md — Cadrage de la Slice 30
> Basé sur `booking_routes.py:115–382, 558–670`, `models.py:326–343` (BookingRequest), `pricing_engine.py`, `stripe_service.py:292–380`.
> Généré le 2026-04-20.

---

## Flow choisi — Booking Create + Pay (parcours acheteur core) — 3 endpoints

| # | Méthode | Chemin API | Auth | Complexité | Fichier : Lignes |
|---|---|---|---|---|---|
| 1 | POST | `/api/bookings/price-preview` | STRICTE | MOYENNE | `booking_routes.py` : 115–158 |
| 2 | POST | `/api/bookings/request` (+ alias `POST /api/bookings`) | STRICTE | **TRÈS ÉLEVÉE** | `booking_routes.py` : 165–382, 385–394 |
| 3 | POST | `/api/bookings/{booking_id}/pay` | STRICTE (payer OU admin) | ÉLEVÉE | `booking_routes.py` : 558–670 |

---

## Justification — Pourquoi ce bundle pour cutover front

| Critère | Justification |
|---|---|
| **Indissociable côté front** | Un acheteur qui peut créer une réservation sans pouvoir payer = parcours cassé. Les 3 endpoints forment **un seul workflow UX** : "voir le prix → réserver → payer". Migrer l'un sans l'autre laisse le front bloqué. |
| **Flow "argent" = priorité cutover #1** | Après les read/write SpotYou (S26–S29), le booking-pay est **la seule brique transactionnelle restante** pour le parcours acheteur. Sans ça, pas de revenue possible sur Java. |
| **Introduit 3 patterns neufs** | (1) `pricing_engine.compute_pricing` centralisé ; (2) Row-level lock `SELECT ... FOR UPDATE NOWAIT` (concurrence slot) ; (3) Stripe Checkout Session (intégration externe critique). Aucun n'a été documenté dans les slices précédentes. |
| **Idempotence triple** | (a) clé explicite `idempotency_key` + UNIQUE INDEX, (b) `(slot_id, user_id)` anti-doublon, (c) réutilisation session Stripe existante — **3 niveaux d'idempotence** à migrer 1:1. |
| **Transactions atomiques cross-table** | INSERT booking + INSERT payment + UPDATE service_slot dans **une seule transaction**. Première fois qu'une slice touche `bookings` + `payments` + `service_slots` ensemble. |
| **Stripe = intégration externe bloquante** | Si Stripe n'est pas cadré ici → tout le reste du domaine paiement (capture, refund, webhook) est bloqué. Migrer Stripe en premier ouvre la voie aux slices futures. |

### Alternatives écartées

| Alternative | Pourquoi non |
|---|---|
| **Chat / WebSocket** | Engagement ≠ parcours argent. Le booking est bloquant revenue. WebSocket peut attendre (plus isolé techniquement). |
| **Booking create SEUL** | Le front aurait un bouton "Réserver" qui ne débouche sur rien (pas de paiement Stripe). Frustrant et non-livrable commercialement. |
| **Pay SEUL** | Impossible — requiert un booking existant. |
| **Booking CRUD complet** (+ accept/refuse/cancel/status/list) | Trop gros. Les interactions owner (accept/refuse) et gestion (cancel) ne sont pas sur le chemin critique acheteur. Slice 31 dédiée. |
| **Seulement POST /bookings/request + /pay (sans price-preview)** | price-preview partage 100% du code `pricing_engine` avec /request. Le migrer ailleurs dupliquerait le travail de mapping `PricingResult`. |

---

## Fichiers Python analysés

| Fichier | Lignes | Rôle |
|---|---|---|
| `booking_routes.py` | 49–66 | `BOOKING_EXPIRY_HOURS`, `DEFAULT_PAY_NOW_CHECKOUT_MINUTES`, `_get_pay_now_minutes()` |
| `booking_routes.py` | 68–108 | `BOOKING_FIELDS` projection, `_deserialize`, `_fetch_booking`, `_push` |
| `booking_routes.py` | 115–158 | `POST /bookings/price-preview` |
| `booking_routes.py` | 165–382 | `_do_booking_request()` — moteur du create |
| `booking_routes.py` | 385–394 | `POST /bookings/request` + alias `POST /bookings` |
| `booking_routes.py` | 558–670 | `POST /bookings/{id}/pay` |
| `models.py` | 326–343 | `BookingRequest` Pydantic (7 champs) |
| `models.py` | 30–60 | Enums `BookingStatus`, `SlotStatus`, `PaymentStatus` |
| `pricing_engine.py` | 36–143 | `PricingResult` dataclass + `to_snapshot()` + `to_payment_dict()` |
| `pricing_engine.py` | 146–335 | `PricingEngine.compute_pricing()` — règles tarifaires DB-driven |
| `stripe_service.py` | 138–165 | `capture_payment_intent` (pas utilisé dans cette slice mais cité par accept) |
| `stripe_service.py` | 292–350 | `create_checkout_session`, `retrieve_checkout_session` |
| `push_service.py` | `send_push_to_user` | Push notifications fire-and-forget |
| `database.py` | `get_pool`, `row_to_dict` | Accès DB asyncpg |

---

## Dépendances

| Dépendance | Type | Endpoints | Commentaire |
|---|---|---|---|
| `pricing_engine.compute_pricing` | Service interne | preview, request | Applique règles tarifaires (base_amount + frais payeur/coach selon rules DB + abonnements actifs) |
| `PricingResult.to_snapshot()` | Helper | preview, request | Sérialise pour réponse JSON + colonne `pricing_snapshot` JSONB |
| `PricingResult.to_payment_dict()` | Helper | request | Construit le dict INSERT `payments` |
| Table `services` | DB SELECT | preview, request | `price`, `coach_id`, `booking_approval_mode`, `allow_pay_later`, `pay_later_expiration_minutes` |
| Table `service_slots` | DB SELECT FOR UPDATE NOWAIT + UPDATE | request | Lock + transition état |
| Table `bookings` | DB INSERT + SELECT + UPDATE | request, pay | Entité principale |
| Table `payments` | DB INSERT + SELECT + UPDATE | request, pay | Entité paiement couplée 1-1 |
| Table `app_config` | DB SELECT | request, pay (via `_get_pay_now_minutes`) | Flags globaux `enable_manual_approval_for_services`, `enable_pay_later_for_services`, `pay_now_checkout_minutes` |
| Table `users` | DB SELECT `name` | request (post-commit pour push) | |
| `stripe_service.create_checkout_session` | Stripe API | pay | Crée Stripe Checkout Session |
| `stripe_service.retrieve_checkout_session` | Stripe API | pay | Réutilise session si `status='open'` |
| `push_service.send_push_to_user` | Interne (FCM/APN) | request, pay (indirect) | Fire-and-forget post-commit |
| `BOOKING_EXPIRY_HOURS` | ENV | request (flux manual_approval) | Défaut 48h |
| `DEFAULT_PAY_NOW_CHECKOUT_MINUTES` | const = 30 | request (si app_config absent) | |
| `DEFAULT_PAY_LATER_MINUTES` | const = 1440 (24h) | request | Fallback si service n'a pas `pay_later_expiration_minutes` |

---

## Niveau de risque

**TRÈS ÉLEVÉ.**

| Point | Risque | Impact Java |
|---|---|---|
| Machine d'états booking + slot + payment | **TRÈS ÉLEVÉ** | 4 flux (A/B/C/D) combinant `booking_approval_mode` × `payment_mode`. Doc exhaustive critique. |
| Row-level lock `FOR UPDATE NOWAIT` + gestion `asyncpg.LockNotAvailableError` | **ÉLEVÉ** | Java doit mapper sur `SELECT ... FOR UPDATE NOWAIT` (PostgreSQL natif), catcher `PSQLException` code `55P03` (lock_not_available) → HTTP 409 |
| Triple idempotence (clé + slot×user + Stripe session) | ÉLEVÉ | 3 chemins de retour "court-circuit" — tous doivent renvoyer un booking déjà existant (pas 409) |
| Pricing engine DB-driven avec règles paramétrables | ÉLEVÉ | `pricing_engine` est hors slice mais ses résultats sont sérialisés en `pricing_snapshot` JSONB. Reproduire le format EXACT. |
| Stripe Checkout Session + PaymentIntent lifecycle | ÉLEVÉ | Amount en cents, currency lowercase, `metadata`, `idempotency_key=payment_id`, extraction `session.payment_intent` (peut être string OU objet Stripe) |
| Flags globaux `app_config` peuvent **downgrader** le approval_mode et bloquer pay_later | MOYEN | Le code Python **force** `approval_mode = "instant_booking"` si flag global OFF. Même si `services.booking_approval_mode = 'manual_approval'`. |
| `payer_user_id` NULL fallback sur `user_id` (bookings seedés) | MOYEN | Garde de rétrocompat. À documenter pour ne pas l'oublier en Java. |
| Reprise de session Stripe `status='open'` | MOYEN | Si `retrieve_checkout_session` throw → créer une nouvelle (try/except silencieux) |
| URL return Stripe avec `{CHECKOUT_SESSION_ID}` literal | FAIBLE | Token Stripe remplacé côté Stripe — ne pas URL-encode les accolades. |

---

## Résumé ultra court

- **Flow choisi** : `POST /bookings/price-preview` + `POST /bookings/request` (+alias `POST /bookings`) + `POST /bookings/{id}/pay` — 3 endpoints (parcours acheteur complet)
- **Tables touchées** : `bookings` (INSERT/UPDATE), `payments` (INSERT/UPDATE), `service_slots` (SELECT FOR UPDATE NOWAIT + UPDATE), `services` (SELECT config), `app_config` (SELECT flags), `users` (SELECT name post-commit)
- **Top 3 pièges** :
  1. **`SELECT ... FOR UPDATE NOWAIT` + `asyncpg.LockNotAvailableError` → 409** : Java doit catcher PostgreSQL SQLState `55P03` et retourner `"Ce créneau est en cours de réservation — réessayez"`. Ne PAS blocking-wait.
  2. **Flags globaux `app_config` écrasent la config du service** : un service `manual_approval` est forcé en `instant_booking` si flag global OFF. Et `pay_later` demandé alors que flag global OFF → **409** (pas 400). Compat stricte.
  3. **Idempotence triple** : clé explicite (SELECT+short-circuit), slot×user (SELECT+short-circuit), session Stripe open (retrieve+short-circuit). **Tous les 3 short-circuits retournent 200** avec les données existantes, pas 409.
- **Raison du choix** : les 3 endpoints forment le **parcours acheteur core** (voir prix → réserver → payer). Migrer l'un sans les autres = front cassé. Introduit 3 patterns structurants (pricing_engine, lock NOWAIT, Stripe Checkout) réutilisés dans toutes les slices booking/payment suivantes. **Bloque la continuité cutover si repoussé.**
