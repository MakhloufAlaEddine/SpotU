# SLICE_17_SCOPE.md — Cadrage de la Slice 17
> Sources : `payment_routes.py:83–351`.
> Généré le 2026-02-XX.

---

## Justification du choix — Flux Checkout complet

### Pourquoi ces deux endpoints ensemble après le webhook (S16) ?

| Critère | Valeur |
|---|---|
| **Déblocage critique** | Sans `POST /checkout/session`, aucun booking `awaiting_payment` ne peut jamais être payé — le flux payer est bloqué |
| **Complète S16** | Le webhook (S16) gère les events ASYNCHRONES. `GET /checkout/status` est leur pendant SYNCHRONE (appelé immédiatement après le redirect Stripe) |
| **Inséparables** | Le `POST` stocke `stripe_checkout_session_id` → le `GET` s'en sert pour retrouver le payment. Ils forment un seul flux atomique |
| **Pas de Stripe supplémentaire** | Ces deux endpoints n'ajoutent pas de nouvelles dépendances Stripe — ils utilisent les mêmes transitions que S16 |
| **Sans workers / abonnements** | 100% conforme aux contraintes utilisateur |

### Comparaison des candidats Slice 17

| Candidat | Requis pour | Complexité | Verdict |
|---|---|---|---|
| `POST /checkout/session` + `GET /checkout/status` ✅ | Payer peut payer | MOYEN | **Slice 17** |
| Vraie capture Stripe dans `/accept` | Déjà stub doc S13, basse priorité | FAIBLE | Slice 19+ |
| `PATCH /payments/{id}/stripe` | Usage interne uniquement | FAIBLE | Slice 18 |
| `GET /payments/me` + `GET /payments/{id}` | Read — faible risque | FAIBLE | Slice 18 |
| Abonnements webhook | Exclu utilisateur | — | Slice 20+ |

---

## Endpoints inclus

| # | Méthode | Chemin Python | Chemin Java | Fichier | Lignes |
|---|---|---|---|---|---|
| 1 | POST | `/api/payments/checkout/session` | `/api/payments/checkout/session` | `payment_routes.py` | 85–192 |
| 2 | GET | `/api/payments/checkout/status/{session_id}` | `/api/payments/checkout/status/{sessionId}` | `payment_routes.py` | 195–351 |

**Montage :** `api_router.include_router(payment_router)` — `server.py`

---

## Auth

| Endpoint | Auth | Détail |
|---|---|---|
| `POST /checkout/session` | **STRICTE** | 401 si absent — `require_auth(request, pool)` |
| `GET /checkout/status/{session_id}` | **OPTIONNELLE** | `try: user = require_auth(...)` / `except: user = None` |

> ℹ️ La vérification optionnelle de `GET /status` est intentionnelle : Stripe redirige le payer
> vers `success_url?session_id=cs_xxx` — à ce moment, le token JWT peut ne pas être disponible
> (redirect web). Le `session_id` Stripe est lui-même un identifiant secret suffisant.

---

## Body

### POST /payments/checkout/session

```python
# payment_routes.py:98–100
body = await request.json()
booking_id = body.get("booking_id")
origin_url  = body.get("origin_url", "").rstrip("/")
```

```json
{
  "booking_id": "bkg_abc123",
  "origin_url": "https://app.spotu.fr"
}
```

- `booking_id` : **obligatoire** (400 si absent)
- `origin_url` : **optionnel** — utilisé pour construire `success_url` et `cancel_url`. Valeur par défaut : `""`

---

## Dépendances

| Dépendance | Type | Rôle |
|---|---|---|
| Table `payments` (LEFT JOIN `bookings`) | DB | Lecture amount + payer check |
| Table `bookings` | DB | Lecture status pour status endpoint |
| `stripe_service.create_checkout_session()` | Stripe | Création session Checkout |
| `stripe_service.retrieve_checkout_session()` | Stripe | Lecture statut session Checkout |
| `stripe_service.retrieve_checkout_session()` (idempotence) | Stripe | Réutilisation session ouverte |
| `push_service.send_push_to_user()` | Push | Notification post-paiement (GET status uniquement) |
| `STRIPE_API_KEY` | Env var | Authentification Stripe |

---

## Niveau de risque

**MOYEN.**

| Point | Risque |
|---|---|
| `amount_cents` depuis snapshot (JAMAIS recalculé) | Cohérence financière — reproduire exactement |
| `payment_intent` type check dans POST | `session.payment_intent` peut être str ou objet |
| Status CASE idempotent dans UPDATE | Ne pas overwriter 'authorized'/'captured' si webhook déjà passé |
| `GET /status` auth optionnelle | Ne pas bloquer si token absent |
| Duplication logique webhook dans `GET /status` | Même transitions que S16 — risque de divergence |
| `real_session_id` vs param `session_id` | Le param peut être `cs_...` OU `pi_...` |
| Notifications push dans `GET /status` | Uniquement pour instant_booking, pas manual_approval |

---

## Pièges (top 7)

| # | Piège | Détail |
|---|---|---|
| P1 | **`amount_cents` depuis snapshot** | `int(round(float(payment["payer_total_amount"]) * 100))` — JAMAIS recalculer côté Java. Le montant vient toujours de `payments.payer_total_amount`. |
| P2 | **`payment_intent` type check** | `pi_id = session.payment_intent if isinstance(session.payment_intent, str) else None`. Si non-string → stocker NULL. |
| P3 | **UPDATE payments CASE idempotent** | `status = CASE WHEN status NOT IN ('requires_authorization','authorized','captured') THEN 'requires_authorization' ELSE status END` — ne pas overwriter si webhook déjà passé. |
| P4 | **`real_session_id` pour retrieve** | Le paramètre URL `session_id` peut être un `cs_...` ou un `pi_...`. Toujours utiliser `payment["stripe_checkout_session_id"] or session_id` pour appeler Stripe. |
| P5 | **`GET /status` : branche instant vs manual** | Même event `complete + unpaid` → 2 comportements selon `bookings.status`. Un SELECT sur `bookings.status` est OBLIGATOIRE avant la décision. |
| P6 | **Stripe retrieve failure → graceful** | Si `retrieve_checkout_session()` échoue → retourner les données DB avec `status="unknown"`. Ne pas lever d'exception. |
| P7 | **`{CHECKOUT_SESSION_ID}` dans success_url** | C'est un **placeholder Stripe** (littéral dans l'URL), pas une variable Python. Stripe le remplace automatiquement. Ne pas interpoler côté Java. |
