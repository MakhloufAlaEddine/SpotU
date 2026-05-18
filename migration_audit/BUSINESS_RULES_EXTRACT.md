# BUSINESS_RULES_EXTRACT.md

Règles **observables** dans le code cité. **Confiance** : **haute** si citation directe ; **moyenne** si déduction multi-fichiers ; **basse** si non lu en profondeur.

---

## 1. Authentification & comptes

| Règle | Source | Confiance |
|-------|--------|-----------|
| Mot de passe inscription ≥ 6 caractères | `models.py` `UserCreate.password` validator | Haute |
| Nom inscription non vide | `models.py` `UserCreate.name` | Haute |
| Hash bcrypt + vérif | `auth_utils.py` | Haute |
| JWT HS256, exp 7 jours, claims `user_id`, `role` | `auth_utils.py` `JWT_ALGORITHM`, `JWT_EXPIRE_DAYS`, `create_jwt` | Haute |
| Login refuse si user absent ou mauvais mot de passe | `auth_routes.py` `login` | Haute |
| Google OAuth : session Emergent obligatoire, email requis | `auth_utils.py` `fetch_emergent_session` | Haute |
| Token aussi lu depuis cookie `winek_token` | `auth_utils.py` `get_token_from_request` | Haute |

---

## 2. Réservation & configuration globale

| Règle | Source | Confiance |
|-------|--------|-----------|
| Flags `enable_manual_approval_for_services`, `enable_pay_later_for_services`, `pay_now_checkout_minutes` exposés en public | `server.py` `public_booking_config` | Haute |
| Commission service : lecture `pricing_rules` actives `product_type = 'service_booking'` | `server.py` `public_commission_config` | Haute |
| Workflow réservation + paiement : nombreuses transitions | `booking_routes.py`, `webhook_handlers.py` (commentaire en-tête) | Moyenne — détail par statut **non** entièrement recopié ici |
| Expiration bookings : worker TTL `BOOKING_EXPIRY_HOURS` (défaut 48h dans commentaire startup) | `server.py` startup | Moyenne |

---

## 3. Paiements & Stripe

| Règle | Source | Confiance |
|-------|--------|-----------|
| Webhook Stripe = source de vérité statuts (`payments`, `bookings`, `user_subscriptions`) avec exception documentée (accept + webhook) | `webhook_handlers.py` docstring L20–24 | Haute |
| Idempotence par `event_id` dans `stripe_webhook_events` | `webhook_handlers.py` docstring | Haute |
| Liste d’événements Stripe gérés (checkout, payment_intent, charge.refunded, subscription, invoice…) | `webhook_handlers.py` docstring | Haute |
| Signature webhook si `STRIPE_WEBHOOK_SECRET` défini | `payment_routes.py` `stripe_webhook` | Haute |
| Clé test `sk_test_emergent` → API Stripe proxy Emergent | `stripe_service.py` (grep conversation) | Haute |

---

## 4. SpotYou / Tag points (extrait)

| Règle | Source | Confiance |
|-------|--------|-----------|
| Horaires `event_schedule` : fin > début si dict `{start,end}` | `models.py` `TagPointCreate.validate_schedule_times` | Haute |
| Bug potentiel : double `return v` consécutif | `models.py` (même validator) | Haute (syntaxe) — impact métier : **faible** (second return inaccessible) |
| Visibilité / join_mode / invite par défaut sur `TagPointCreate` | `models.py` champs optionnels | Haute |

**Règles détaillées invitations / join requests** : dans `tagpoint_routes.py` — **non extraites** ligne à ligne (confiance **basse** pour liste exhaustive).

---

## 5. Pricing / commission code

| Règle | Source | Confiance |
|-------|--------|-----------|
| `COMMISSION_RATE = 0.15` défini | `auth_utils.py` | Haute (présence) |
| Utilisation réelle dans calculs | — | **Flou** : grep dédié non effectué sur tout le repo dans cet audit |

---

## 6. Upload images

| Règle | Source | Confiance |
|-------|--------|-----------|
| Taille max 15 Mo (commentaire SEC-08 mentionne 5 Mo en docstring vs 15 dans constante — **incohérence documentée**) | `upload_routes.py` `MAX_UPLOAD_SIZE` vs docstring | Moyenne — **à clarifier** |
| Validation magic bytes, pas Content-Type seul | `upload_routes.py` | Haute |
| Catégories autorisées ensemble fini | `upload_routes.py` `_ALLOWED_CATEGORIES` | Haute |

---

## 7. Rate limiting

| Règle | Source | Confiance |
|-------|--------|-----------|
| slowapi, clé = IP (X-Forwarded-For ou client) | `limiter.py` | Haute |
| Mode `TESTING` : pas de limite sauf header spécial | `limiter.py` | Haute |
| Login/register 5/min, google 10/min (d’après tests) | `backend/tests/test_ratelimit_sec03.py` | Moyenne — décorateurs exacts sur `auth_routes.py` **à vérifier** fichier source |

---

## 8. Données personnelles / rétention

| Règle | Source | Confiance |
|-------|--------|-----------|
| Purge médias J+90, notification J+83 | `server.py` startup + noms workers | Moyenne — détail dans `media_purge_worker.py` / `media_notif_worker.py` **non relu** intégralement |
| Purge fichiers différés `pending_file_deletions` | `admin_purge_worker.py` en-tête | Haute (concept) |

---

## 9. Ambiguïtés globales

- Cohérence **exacte** entre enums Pydantic et **CHECK** SQL / données legacy.
- Règles **pricing_engine.py** : fichier non audité en profondeur.
- Règles **chat_manager.py** (accès WS, anti-abus) : **flou**.
