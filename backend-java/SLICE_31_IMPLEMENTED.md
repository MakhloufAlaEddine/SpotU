# SLICE_31_IMPLEMENTED.md

Implémentation de la slice 31 : fermeture du parcours acheteur après redirection Stripe via l’endpoint de statut checkout.

## Endpoint couvert

- `GET /api/payments/checkout/status/{sessionId}`

Implémenté dans :

- `src/main/java/com/spotu/modules/payments/api/CheckoutController.java`
- `src/main/java/com/spotu/modules/payments/service/CheckoutService.java`
- `src/main/java/com/spotu/modules/payments/infra/CheckoutRepository.java`

## Comportement livré (fidélité Python)

- Auth optionnelle (jamais 401 sur cet endpoint)
  - route publique (`permitAll`) + JWT filter best-effort silencieux
- Lookup DB par `stripe_checkout_session_id` **ou** `stripe_payment_intent_id`
- Fallback Stripe indisponible :
  - retour 200 avec `status="unknown"`
  - pas de `stripe_status` dans la réponse fallback
  - log warning aligné : `Impossible de récupérer la session Stripe ...`
- Matrice de branches conservée avec ordre strict :
  1. `complete + unpaid` (1-A instant / 1-B manual)
  2. `paid` -> captured
  3. `expired + authorized` -> cancelled
  4. sinon no-op
- Branche 1-A (instant booking) :
  - updates DB
  - re-lecture users payment
  - push synchrones (bloquants) x2, sans `@Async`, sans listener post-commit
- Gestion `amount` alignée Python :
  - `amount_total > 0` -> cents/100
  - sinon fallback `payments.payer_total_amount`

## Tables touchées

- `payments`
  - SELECT lookup session/intent
  - UPDATE status (`authorized`/`captured`/`cancelled`)
  - SELECT `payer_user_id`, `receiver_user_id` (branche 1-A)
- `bookings`
  - SELECT status (discrimination instant/manual)
  - UPDATE `status='confirmed'`, `payment_status='paid'` (guardé)
  - UPDATE `payment_status='authorized'` (branche 1-B)
- `services`
  - SELECT title pour contenu notification (branche 1-A)
- `notifications`
  - INSERT sync des 2 notifications en branche 1-A

## Dépendances Stripe

- Réutilisation de `StripeCheckoutService.retrieveCheckoutSession(...)`
- Compat conservée pour lookup `pi_*` (si retrieve échoue, fallback unknown)

## Tests

Fichier mis à jour :

- `src/test/java/com/spotu/modules/payments/api/CheckoutIntegrationTest.java`

Cas ajoutés/couverts :

- nominal branche 1-A (instant -> captured + 2 notifications)
- nominal branche 1-B (requested -> authorized)
- fallback Stripe down (`unknown`, sans `stripe_status`)
- auth optionnelle (sans token / token invalide)
- non-régression des cas existants

Validation exécutée :

- `mvn -Dtest=CheckoutIntegrationTest test` ✅
- `mvn test` ✅

## Écarts restants / cutover

Le parcours acheteur post-Stripe est désormais fermé côté Java (S30 + S31).

Reste encore pour un cutover paiement totalement complet :

- migration du webhook Stripe complet (`POST /api/webhook/stripe`) et toutes ses branches fines event-driven
- endpoints de lecture paiements métier (`/payments/me`, `/payments/{id}`) si requis pour écrans historiques
- envoi push mobile réel (Expo/APNS/FCM) au-delà de la persistance `notifications`
