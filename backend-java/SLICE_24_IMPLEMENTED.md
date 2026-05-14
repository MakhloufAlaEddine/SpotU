# Slice 24 — Profile write, upload, push tokens

Implémenté le **2026-04-15** en continuité de la slice 23 (infra auth canonique).

## Endpoints créés/couverts

- `PUT /api/users/profile`
- `POST /api/users/become-coach`
- `PATCH /api/users/{user_id}/cover`
- `POST /api/upload-image`
- `POST /api/upload-image/debug-422`
- `POST /api/push-token`
- `DELETE /api/push-token`

## Composants créés/modifiés

- `modules/users/api/UserProfileWriteController`
- `modules/users/service/UserProfileWriteService`
- `modules/users/service/UserProfileWriteRepository`
- `modules/uploads/api/UploadController`
- `modules/uploads/service/UploadService`
- `modules/uploads/service/FileStorageService`
- `modules/push/api/PushTokenController`
- `modules/push/service/PushTokenService`
- `modules/push/infra/PushTokenRepository`
- `error/GlobalExceptionHandler` (mapping `ResponseStatusException` → status+detail)

## Tables touchées

- `users` (update dynamique profil, transition role coach, update cover)
- `push_tokens` (upsert logique + soft disable)

## Intégrations externes utilisées

- **Cloudflare R2 (S3-compatible)** via AWS SDK v2 (`software.amazon.awssdk:s3`), si configuré (`R2_*`).
- Fallback local upload (`/app/backend/uploads`) si R2 non configuré/erreur.

## Alignements Python respectés

- `PUT /profile` : update dynamique + clearables (`iban`, `bic`, `iban_name`, `bio`, `phone`, `picture`).
- `name` vide sur profile : `400 "Le nom est obligatoire"`.
- `POST /become-coach` : bloque `coach/admin` (`400 "Already a coach or admin"`).
- `PATCH /cover` : ownership strict + suppression ancienne cover.
- Upload : auth stricte, limite 15 Mo, validation magic bytes (JPEG/PNG/GIF/WebP/HEIC), fallback catégorie `other`.
- Push token : validation format Expo, réactivation same user (`updated`), transfert inter-user (`registered`), delete soft (`unregistered`).

## Tests

- Nouveau fichier : `UserProfileWriteIntegrationTest`
  - update profil partiel + clearable
  - become-coach déjà coach
  - ownership cover 403
  - upload success + upload invalid magic bytes
  - push token register/update/delete
- Suite globale : `mvn test` **verte**.

## Écarts assumés / restants (Bloc 1)

- Upload local fallback écrit en filesystem local ; l’exposition statique `/api/uploads/**` reste à traiter si besoin CDN/proxy.
- Compression image Java via `ImageIO` (HEIC conservé brut si non décodable), là où Python utilise Pillow + plugin optionnel.
