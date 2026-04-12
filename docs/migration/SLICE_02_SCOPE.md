# SLICE_02_SCOPE.md — Cadrage de la Slice 02
> Basé sur `auth_routes.py:92–95`, `auth_utils.py` (complet), `database.py` + réponse API live.  
> Généré le 2026-04-12.

---

## Endpoint inclus

| # | Méthode | Chemin | Fichier Python | Ligne |
|---|---|---|---|---|
| 1 | GET | `/api/auth/me` | `auth_routes.py` | 92–95 |

---

## Endpoints explicitement exclus de cette slice

| Endpoint | Raison d'exclusion |
|---|---|
| `POST /api/auth/login` | Vérifie le password bcrypt + crée le JWT — Slice 3+ |
| `POST /api/auth/register` | Crée un user + JWT — Slice 3+ |
| `POST /api/auth/logout` | Appelle `require_auth` mais ne fait que retourner `{success: true}` — trivial, Slice 3 |
| `PUT /api/auth/change-password` | Dépend de `require_auth` + bcrypt write — Slice 3+ |
| `POST /api/auth/google` | Proxy Emergent OAuth — Slice 18 |
| `GET /api/auth/native-callback` | Redirect 302 OAuth mobile — Slice 18 |
| Tous les autres endpoints authentifiés | Dépendent de la même infrastructure auth — utilisent `require_auth` |

---

## Dépendances exactes

### Ce qui doit déjà exister côté Java avant d'implémenter cette slice

| Dépendance | Type | Obligatoire | Détail |
|---|---|---|---|
| Connexion PostgreSQL (Supabase) | Infrastructure | OUI | Pool JDBC, SSL avec CA cert Supabase |
| `JWT_SECRET` en variable d'env | Config | OUI | Même secret que Python — clé HS256 partagée |
| Bibliothèque JWT Java | Dépendance | OUI | `jjwt` (io.jsonwebtoken) ou `java-jwt` (Auth0) |
| Table `users` accessible | DB | OUI | Via le même Supabase |
| `UserRepository` avec requête USER_FIELDS | Repository | OUI | 18 colonnes exactes — voir SLICE_02_DB_MAPPING.md |
| Filtre `JwtAuthFilter` (ou Security interceptor) | Auth | OUI | Lit le Bearer token, décode, stocke dans SecurityContext |
| `UserDetailsService` ou équivalent | Auth | OUI | Charge l'utilisateur depuis la DB via `user_id` |

### Absence de dépendances (confirmé)

- ❌ Pas de bcrypt (lecture seule)
- ❌ Pas de Stripe
- ❌ Pas d'upload
- ❌ Pas de workers
- ❌ Pas de WebSocket
- ❌ Pas de push notifications
- ❌ Pas de Redis / cache
- ❌ Pas d'écriture en DB

---

## Niveau de risque

**MOYEN.**

- Logique applicative simple (lecture seule, retourne l'utilisateur courant)
- **Risque principal : infrastructure JWT** — le secret doit être identique côté Java et Python, les tokens émis par Python doivent être valides côté Java
- **Risque secondaire : colonnes USER_FIELDS** — 18 colonnes précises, 0 erreur de nommage autorisée

---

## Raisons du choix de cette slice

1. **Première slice authentifiée** — valide toute l'infrastructure JWT avant d'aller plus loin
2. **Zéro effet de bord** — lecture seule, pas de mutation
3. **Bloquant pour toutes les slices suivantes** — chaque endpoint authentifié utilise `require_auth`
4. **Permet la cohabitation Python/Java** — les tokens émis par Python seront valides côté Java si `JWT_SECRET` est identique
5. **Test de compatibilité end-to-end** : login via Python → GET /auth/me via Java

---

## Pièges éventuels

| # | Piège | Détail |
|---|---|---|
| P1 | `JWT_SECRET` doit être identique | Python lit `JWT_SECRET` depuis `.env`. Java doit lire la même valeur depuis `application.yml` ou variable d'env. Un secret différent → tous les tokens Python invalides côté Java. |
| P2 | Claim JWT `user_id` (pas `sub`) | La convention standard JWT utilise `sub` mais Python utilise le claim custom `user_id`. La bibliothèque Java doit lire `payload.get("user_id")` pas `getSubject()`. |
| P3 | Colonnes USER_FIELDS : 18 exactes | `coach_tags`, `goals`, `user_roles` sont des JSONB → deserializer spécifique requis. `created_at` / `updated_at` sont des TIMESTAMPTZ → format ISO avec timezone. |
| P4 | Fallback cookie | Python lit aussi le token depuis le cookie `winek_token`. Java doit reproduire ce comportement (rare mais documenté). |
| P5 | Pas de vérification `deleted_at` | `require_auth` ne vérifie PAS si le user est supprimé/désactivé. Si le `user_id` existe en DB, l'utilisateur est authentifié. Ne PAS ajouter cette vérification en Java v1. |
