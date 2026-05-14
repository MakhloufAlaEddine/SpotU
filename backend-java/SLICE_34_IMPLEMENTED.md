# Slice 34 — Payment Reads (`/api/payments/me`, `/api/payments/{id}`)

Date: 2026-04-25

## Objectif

Porter les endpoints de lecture paiements utiles au front, avec parité Python stricte:

- `GET /api/payments/me`
- `GET /api/payments/{id}`

## Implémentation

### Endpoints ajoutés

Fichier:
- `src/main/java/com/spotu/modules/payments/api/PaymentReadController.java`

Routes:
- `GET /api/payments/me`
- `GET /api/payments/{paymentId}`

### Service métier read

Fichier:
- `src/main/java/com/spotu/modules/payments/service/PaymentReadService.java`

Points clés:
- `/me`: retourne la liste brute, sans pagination.
- `/{id}`: ordre strict des checks:
  1. auth
  2. existence payment (404)
  3. permissions (403)
- permissions détail 3-OR conformes:
  - payer
  - receiver
  - admin
- désérialisation `pricing_rule_snapshot` si string JSON
- conversion type Python-like:
  - `BigDecimal` -> number JSON
  - `Timestamp`/temps -> ISO UTC `+00:00` microsecondes via `PythonIsoTimestamps`

### Repository read

Fichier:
- `src/main/java/com/spotu/modules/payments/infra/PaymentReadRepository.java`

Queries:
- `/me`:
  - `SELECT p.*` + `LEFT JOIN users` pour `payer_name` et `receiver_name`
  - filtre `payer_user_id = uid OR receiver_user_id = uid`
  - `ORDER BY p.created_at DESC`
- `/{id}`:
  - `SELECT * FROM payments WHERE payment_id = ?`

### Schéma / migration

Ajouts:
- `src/main/resources/db/migration/V5__payments_created_at_for_reads.sql`
  - ajoute `payments.created_at` si absent
  - backfill `created_at = updated_at` si null
- `src/test/resources/test-schema-users.sql`
  - ajoute colonne `created_at` dans `payments`

## Tests

Nouveau fichier:
- `src/test/java/com/spotu/modules/payments/api/PaymentReadIntegrationTest.java`

Cas couverts:
- nominal `/me` (tri, noms, snapshot)
- auth cookie fallback (`winek_token`)
- liste vide (`[]`)
- auth manquante (401)
- nominal `/{id}` + asymétrie champs détail (pas de `payer_name/receiver_name`)
- ordre strict 404 puis 403
- accès admin
- format datetime `+00:00`

## Validation

- `mvn -Dtest=PaymentReadIntegrationTest test` ✅
- `mvn test` (régression globale slices 01→33 incluse) ✅

## Tables touchées

- **Lecture**:
  - `payments`
  - `users` (JOIN noms dans `/me`)
- **Migration schéma**:
  - `payments` (ajout colonne `created_at` pour alignement contrat read)

## Écarts restants

- Aucun écart bloquant identifié dans le périmètre Slice 34.
- Pas de pagination sur `/me` conservée volontairement (parité Python stricte).
