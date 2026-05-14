# MODULES_PLANNED.md

Packages Java sous `com.spotu.modules.*`.

### Implémenté (slice 01)

| Package | Statut |
|---------|--------|
| `com.spotu.modules.config` | **Actif** — config publique `/api/config/booking`, `/api/config/commission` |

### Placeholders (autres modules)

| Package | Responsabilité future (alignement audit) |
|---------|------------------------------------------|
| `com.spotu.modules.auth` | Login, register, JWT, OAuth Google |
| `com.spotu.modules.users` | Profils, social, recherche utilisateurs |
| `com.spotu.modules.admin` | Administration (hors infra `/api` déjà partiellement couverte côté Python) |
| `com.spotu.modules.booking` | Réservations, alias `my_bookings` / `received_bookings` |
| `com.spotu.modules.payments` | Paiements, webhooks Stripe, admin listes arbitrées |
| `com.spotu.modules.uploads` | `POST /api/upload-image`, alignement chemins disque / R2 |
| `com.spotu.modules.websocket` | WS chat / notifications / SpotYou (handshake JSON token) |
| `com.spotu.modules.spotyou` | Domaine SpotYou HTTP |
| `com.spotu.modules.service` | Services coach, PUT/PATCH `update_service` |
| `com.spotu.modules.marketplace` | Marketplace produits |

## Packages transverses (déjà créés)

| Package | Rôle |
|---------|------|
| `com.spotu.config` | Sécurité, Web MVC |
| `com.spotu.error` | `@ControllerAdvice` global |
| `com.spotu.infra.api` | Liveness, readiness |
