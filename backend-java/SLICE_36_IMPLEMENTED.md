# Slice 36 — Booking Reads (Audit + Régression)

Date: 2026-04-26

## Objectif

Vérifier que les endpoints booking read migrés en S11 restent strictement conformes après les slices S30/S31/S33/S35, sans réécriture des endpoints.

## Résultat de conformité

- **Conforme: OUI**
- Aucun écart fonctionnel détecté sur les endpoints:
  - `GET /api/bookings/me` (+ alias `/api/users/me/bookings`)
  - `GET /api/bookings/received` (+ alias `/api/receiver/requests`)
  - `GET /api/bookings/{booking_id}`

## Audit effectué (S36)

Vérifications confirmées dans l’implémentation Java existante:
- alias routes actifs et alignés
- `404` avant `403` sur `/{id}`
- permissions détail **4-OR + admin** (`user_id`, `payer_user_id`, `receiver_user_id`, `coach_id`)
- projections asymétriques préservées entre les 3 endpoints
- désérialisation conditionnelle silencieuse de `pricing_snapshot`
- format datetime ISO avec `+00:00`
- absence de JOIN `payments` dans les booking reads (donc pas de `refund_amount`/`refund_status`)

## Modifications réalisées

### 1) Aucun changement endpoint/service/repository

Pas de correction de code métier nécessaire (comportement déjà conforme à S11/S36).

### 2) Renforcement tests de régression S36

Fichier modifié:
- `src/test/java/com/spotu/modules/bookings/api/BookingReadIntegrationTest.java`

Tests ajoutés:
- visibilité post-mutation S33 (`status='confirmed'`, `payment_status='paid'`) via booking reads
- validation post-refund S35: booking reads restent inchangés et **n’exposent pas** `refund_amount`/`refund_status`
- permissions legacy: accès autorisé via `coach_id` et via `user_id` sur `/{id}`
- vérification format datetime `+00:00` (pas `Z`)

## Exécution des tests

- `mvn -Dtest=BookingReadIntegrationTest test` ✅

## Écarts corrigés

- Aucun écart de parité endpoint détecté.
- Ajustement uniquement côté couverture de tests de régression S36.

## Tables touchées

- Aucune table supplémentaire par le code applicatif (slice d’audit/lecture).
- En test: lecture `bookings/services/users/service_slots` + scénario webhook S35 déjà existant.

## Écarts restants

- Aucun écart bloquant identifié dans le périmètre S36.
