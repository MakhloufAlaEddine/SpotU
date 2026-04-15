# SLICE_24_SCOPE.md — Cadrage de la Slice 24
> Basé sur `user_routes.py:33–96,525–563`, `upload_routes.py` (203 lignes), `push_routes.py` (68 lignes).
> Généré le 2026-04-15.

---

## Flow choisi — User profile write + Upload image + Push tokens (7 endpoints)

### Cible

Documenter les endpoints qui permettent à un utilisateur de **configurer son compte** après inscription (S23) : modifier son profil, uploader des images, gérer sa photo de couverture, devenir coach, et activer les push notifications.

| # | Méthode | Chemin API | Auth | Fichier | Complexité |
|---|---|---|---|---|---|
| 1 | PUT | `/api/users/profile` | STRICTE | `user_routes.py:33` | MOYENNE |
| 2 | POST | `/api/users/become-coach` | STRICTE | `user_routes.py:84` | FAIBLE |
| 3 | PATCH | `/api/users/{user_id}/cover` | STRICTE | `user_routes.py:525` | FAIBLE |
| 4 | POST | `/api/upload-image` | STRICTE | `upload_routes.py:125` | ÉLEVÉE |
| 5 | POST | `/api/upload-image/debug-422` | AUCUNE | `upload_routes.py:114` | TRIVIALE |
| 6 | POST | `/api/push-token` | STRICTE | `push_routes.py:15` | FAIBLE |
| 7 | DELETE | `/api/push-token` | STRICTE | `push_routes.py:57` | TRIVIALE |

---

## Justification du choix

### Pourquoi ces 7 ensemble ?

| Critère | Justification |
|---|---|
| **Upload = dépendance de profile write** | `PUT /profile` importe `delete_upload_file` depuis `upload_routes.py` pour supprimer l'ancienne photo |
| **Cover aussi** | `PATCH /cover` utilise le même `delete_upload_file` |
| **Flow utilisateur cohérent** | Après register (S23), l'utilisateur : upload photo → set profil → active push |
| **Push tokens tiny** | 68 lignes, 2 endpoints trivials — les séparer serait du gaspillage |
| **Complète le "user setup"** | Après S24, un utilisateur peut configurer tout son compte |

### Pourquoi MAINTENANT ?

| Critère | Valeur |
|---|---|
| S23 auth terminé | L'utilisateur peut s'inscrire/connecter — maintenant il configure son profil |
| Upload bloque d'autres slices | Services CRUD (S32), SpotYou CRUD (S29), Chat (S34) — tous utilisent upload |
| Push tokens bloque les notifications | Les workers envoient des notifications push — le token doit être enregistré |

---

## Fichiers Python analysés

| Fichier | Lignes | Rôle |
|---|---|---|
| `user_routes.py` | 33–96 | PUT /profile, POST /become-coach |
| `user_routes.py` | 525–563 | PATCH /{uid}/cover |
| `upload_routes.py` | 1–203 | POST /upload-image, debug, delete_upload_file, delete_upload_files |
| `push_routes.py` | 1–68 | POST + DELETE /push-token |
| `r2_storage.py` | — | Module Cloudflare R2 (compress_image, upload_to_r2, is_r2_configured, delete_from_r2) |
| `models.py` | 92–107 | UserUpdate DTO (16 champs optionnels) |

---

## Dépendances

| Dépendance | Type | Endpoints |
|---|---|---|
| Table `users` | DB (UPDATE) | profile, become-coach, cover |
| Table `push_tokens` | DB (INSERT/UPDATE) | push-token |
| Cloudflare R2 | Service externe | upload-image, delete (profile, cover) |
| `R2_PUBLIC_URL` | Env var | URL publique des images R2 |
| `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Env vars | Connexion R2 |
| Pillow (PIL) | Librairie | Compression images avant upload |
| `delete_upload_file()` | Helper | profile (picture change), cover (cover change) |
| `require_auth` | S23 | Tous sauf debug-422 |

---

## Scope explicite

### INCLUS (Slice 24)

- 3 endpoints user write (profile, become-coach, cover)
- 2 endpoints upload (upload-image, debug-422)
- 2 endpoints push tokens
- Helper `delete_upload_file` / `delete_upload_files`
- Module `r2_storage.py` (compression + upload + delete R2)

### EXCLU

| Composant | Raison |
|---|---|
| `GET /users/search` | Slice 25 |
| `GET /users/me/activity-feed` | Slice 25 |
| `GET /users/{uid}/suggestions` | Slice 25 |
| `POST/PUT /users/{uid}/reviews` | Slice 36 (Compléments) |
| `DELETE /users/{uid}/followers/{fid}` | Slice 36 |

---

## Niveau de risque

**MOYEN.**

| Point | Risque | Détail |
|---|---|---|
| Cloudflare R2 intégration | MOYEN | SDK S3-compatible (boto3) → Java AWS SDK S3. Config clés + endpoint custom |
| Compression Pillow | FAIBLE | Java : ImageIO ou Thumbnailator pour le redimensionnement |
| Magic bytes validation | FAIBLE | Reproduire les 5 signatures (JPEG/PNG/GIF/WEBP/HEIC) |
| JSONB fields (coach_tags, goals, user_roles) | FAIBLE | Sérialisation JSON dans le SET dynamique |
| Push token upsert ON CONFLICT | FAIBLE | JPA @Query native avec ON CONFLICT |

---

## Résumé ultra court

- **Flow choisi** : Profile write + Upload (R2) + Push tokens — 7 endpoints formant le flow "configuration compte"
- **Tables touchées** : `users` (UPDATE 13+ colonnes dynamiques), `push_tokens` (INSERT/UPDATE)
- **Top 3 pièges** :
  1. **Upload R2 avec fallback local** : le code tente R2, et si R2 échoue → fallback filesystem local. En Java, reproduire ce dual-storage
  2. **`delete_upload_file` cross-module** : appelé par `PUT /profile` et `PATCH /cover` pour supprimer l'ancienne image — doit distinguer URL R2 vs URL locale
  3. **PUT /profile UPDATE dynamique** avec JSONB cast : les champs `coach_tags`, `goals`, `user_roles` nécessitent un `::jsonb` cast dans le SET dynamique
- **Raison du choix** : upload est la dépendance critique de tous les CRUD à venir (services, SpotYou, chat), et profile write ferme le flow "setup compte" initié par S23
