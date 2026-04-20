# SLICE_29_TEST_CASES.md — Cas de test SpotYou Soft-Delete + Reactivate
> Basé sur `deletion_routes.py:260–431`, règles BR-29.01 à BR-29.13.
> Généré le 2026-04-20.

---

## Convention de naming : `T29-<ENDPOINT>-<CASE>`

- `DEL` = DELETE /api/tag-points/{id}
- `REA` = POST /api/tag-points/{id}/reactivate

---

## 🟢 Nominal — DELETE

### T29-DEL-01 — Soft-delete par owner, SpotYou avec 5 images et 12 membres

**Pré-conditions**
- `caller.user_id = owner` (owner du SpotYou)
- `tag_points.images = ["url1","url2","url3","url4","url5"]`, `active=TRUE`, `deleted_at=NULL`
- 12 membres `spot_you_members.spot_you_id = point_id AND status='accepted'`
- 2 conversations `conversations.context_id = point_id AND context_deleted=FALSE`

**Action**
`DELETE /api/tag-points/abc123` + `Authorization: Bearer <owner_token>`

**Résultat attendu HTTP 200**
```json
{
  "success": true,
  "deleted": true,
  "point_id": "abc123",
  "conversations_marked": 2,
  "images_queued": 5,
  "members_notified": 11,
  "media_purge_scheduled_at": "<now + 90d ISO-8601>"
}
```

**Assertions DB**
- `tag_points` : `active=FALSE`, `deleted_at=<now>`, `deleted_by=owner_user_id`, `updated_at=<now>`, `media_purge_scheduled_at=<now+90d>`
- `conversations` : les 2 lignes ont `context_deleted=TRUE`
- `pending_file_deletions` : 5 lignes avec `entity_type='tag_point'`, `entity_id='abc123'`, `scheduled_at=<now+90d>`, `status='pending'`
- Push envoyés : 11 (tous les membres sauf l'owner). Exclure `members_notified=12` (inclurait l'owner).

---

### T29-DEL-02 — Soft-delete par admin plateforme (non-owner)

**Pré-conditions**
- `caller.role = 'admin'`, `caller.user_id != tag_points.user_id`
- SpotYou avec 0 image, 0 membre, 0 conversation

**Résultat attendu HTTP 200**
```json
{
  "success": true,
  "deleted": true,
  "point_id": "abc123",
  "conversations_marked": 0,
  "images_queued": 0,
  "members_notified": 0,
  "media_purge_scheduled_at": "<now + 90d ISO-8601>"
}
```

**Assertions**
- `tag_points.deleted_by = admin_user_id` (PAS owner_user_id).
- Pas de push envoyé (aucun membre).

---

## 🟢 Nominal — REACTIVATE

### T29-REA-01 — Réactivation avant J+90 (fichiers intacts)

**Pré-conditions**
- SpotYou `deleted_at = <now - 10d>`, `active=FALSE`, `media_purged=FALSE`
- 3 lignes `pending_file_deletions WHERE entity_id=point_id AND status='pending'`
- 1 conversation `context_deleted=TRUE`
- 8 membres (exclu l'owner)

**Action**
`POST /api/tag-points/abc123/reactivate` + `Authorization: Bearer <owner_token>`

**Résultat attendu HTTP 200**
```json
{
  "success": true,
  "reactivated": true,
  "point_id": "abc123",
  "media_purged": false,
  "requires_media_reupload": false,
  "pending_deletions_cancelled": 3
}
```

**Assertions DB**
- `tag_points` : `active=TRUE`, `deleted_at=NULL`, `deleted_by=NULL`, `updated_at=<now>`, `media_purge_scheduled_at=NULL`, `media_purge_notified_at=NULL`, `reactivated_at=<now>`
- 0 ligne `pending_file_deletions WHERE entity_id='abc123'`
- Conversation : `context_deleted=FALSE`
- 8 push envoyés, titre `"SpotYou réactivé 🎉"`

---

### T29-REA-02 — Réactivation après J+90 (worker déjà passé)

**Pré-conditions**
- SpotYou `deleted_at = <now - 95d>`, `active=FALSE`
- `media_purged=TRUE` (worker a passé)
- Lignes `pending_file_deletions` : toutes `status='completed'` (aucune `pending`)

**Résultat attendu HTTP 200**
```json
{
  "success": true,
  "reactivated": true,
  "point_id": "abc123",
  "media_purged": true,
  "requires_media_reupload": true,
  "pending_deletions_cancelled": 0
}
```

**Assertions**
- `tag_points.media_purged` reste `TRUE` (PAS flippé par reactivate — c'est le worker qui l'a fait).
- Images DB restent telles qu'elles (les URLs restent dans `tag_points.images` — le worker supprime les fichiers R2 physiques, pas les URLs DB).
- Front doit rediriger vers upload de nouvelles images.

---

### T29-REA-03 — Réactivation par admin plateforme (autre user)

**Pré-conditions**
- `caller.role='admin'`, `caller.user_id != tag_points.user_id`
- SpotYou avec 3 membres (owner inclus)

**Résultat attendu**
- 3 push envoyés (TOUS y compris l'owner, car REACTIVATE exclut `caller.user_id`, pas `tp.user_id`).
- Confirmer cette asymétrie **BR-29.09**.

---

## 🔴 Auth invalide

### T29-DEL-03 — Sans token

**Action**
`DELETE /api/tag-points/abc123` (pas de header Authorization)

**Résultat attendu**
- `HTTP 401 Unauthorized` (standard `require_auth`)
- Aucune modification DB.

---

### T29-DEL-04 — Token expiré

**Action**
`DELETE /api/tag-points/abc123` + `Authorization: Bearer <expired>`

**Résultat attendu**
- `HTTP 401`
- Aucune modification DB.

---

### T29-REA-04 — Token malformé

**Action**
`POST /api/tag-points/abc123/reactivate` + `Authorization: Bearer not.a.jwt`

**Résultat attendu**
- `HTTP 401`

---

## 🟠 Point introuvable (404)

### T29-DEL-05 — `point_id` inexistant

**Action**
`DELETE /api/tag-points/does-not-exist` + token valide

**Résultat attendu**
```json
{ "detail": "SpotYou introuvable" }
```
- HTTP 404
- Aucune modification DB, aucun push.

---

### T29-REA-05 — `point_id` inexistant

**Action**
`POST /api/tag-points/does-not-exist/reactivate` + token valide

**Résultat attendu**
- HTTP 404
- `{ "detail": "SpotYou introuvable" }`

---

## 🟡 État invalide (409)

### T29-DEL-06 — Déjà soft-deleted

**Pré-conditions**
- SpotYou avec `deleted_at IS NOT NULL`
- Caller = owner (permission OK)

**Action**
`DELETE /api/tag-points/abc123` + `Authorization: Bearer <owner_token>`

**Résultat attendu**
- HTTP 409
- `{ "detail": "Ce SpotYou est déjà supprimé" }`
- **Pas** de 403 même si caller n'est pas owner (409 prime car ordre 404 → 409 → 403).

---

### T29-REA-06 — Déjà actif

**Pré-conditions**
- SpotYou avec `active=TRUE AND deleted_at IS NULL`
- Caller = owner

**Résultat attendu**
- HTTP 409
- `{ "detail": "Ce SpotYou est déjà actif" }`

---

## 🔴 Permission refusée (403)

### T29-DEL-07 — Non-owner non-admin

**Pré-conditions**
- SpotYou existant et actif
- Caller = autre user (non owner, `role='user'`)

**Résultat attendu**
- HTTP 403
- `{ "detail": "Non autorisé" }`

---

### T29-REA-07 — Non-owner non-admin

**Pré-conditions**
- SpotYou soft-deleted
- Caller = autre user

**Résultat attendu**
- HTTP 403
- `{ "detail": "Non autorisé" }`

---

### T29-DEL-08 — Priorité 409 > 403 (SpotYou déjà supprimé + caller non-autorisé)

**Pré-conditions**
- `tp.deleted_at IS NOT NULL`
- `caller.user_id != tp.user_id AND role='user'`

**Résultat attendu**
- HTTP **409** (PAS 403)
- `{ "detail": "Ce SpotYou est déjà supprimé" }`

**Motivation** : ordre strict 404 → 409 → 403 (cf. BR-29.02).

---

### T29-REA-08 — Priorité 409 > 403 (SpotYou déjà actif + caller non-autorisé)

**Résultat attendu** : HTTP 409 (PAS 403).

---

## 🔵 Idempotence / rejouabilité

### T29-DEL-09 — Double appel DELETE rapide

**Action**
1. `DELETE /api/tag-points/abc123` → 200 (premier)
2. `DELETE /api/tag-points/abc123` → 409 "Ce SpotYou est déjà supprimé"

**Assertion** : uniquement 1 batch de push envoyé (premier appel). Les membres ne reçoivent **pas** de double notif.

---

### T29-REA-09 — Delete → Reactivate → Delete → Reactivate (cycle)

**Action** (séquence)
1. `DELETE` → 200 (images_queued=5, media_purge_scheduled_at=<t1+90d>)
2. `POST /reactivate` → 200 (pending_deletions_cancelled=5)
3. `DELETE` → 200 (images_queued=5 **à nouveau**, nouveau `media_purge_scheduled_at=<t3+90d>`)
4. `POST /reactivate` → 200

**Assertion**
- À chaque cycle, `pending_file_deletions` reçoit les N images (grâce à `ON CONFLICT DO NOTHING`, s'il y a une contrainte unique sur `(entity_id, file_url)` + `status`) — **vérifier en DB** que le INSERT 2 passe.
- À la fin, `tag_points.active=TRUE`, `deleted_at=NULL`, `reactivated_at=<dernier reactivate>`.

> ⚠️ **Incertitude** : la contrainte exacte de `pending_file_deletions` détermine si INSERT 2 réussit ou passe en NO-OP. À valider contre `migrations/009` au moment de l'impl.

---

## 🟣 Effets de bord

### T29-DEL-10 — Conversations already `context_deleted=TRUE`

**Pré-conditions**
- 3 conversations liées au SpotYou : 2 avec `context_deleted=FALSE`, 1 avec `context_deleted=TRUE` (legacy)

**Résultat attendu**
- `conversations_marked = 2` (pas 3, grâce au filtre `WHERE context_deleted=FALSE`)

---

### T29-REA-10 — Réactivation ne touche pas les conversations jamais marquées

**Pré-conditions**
- Conversation `context_id=point_id AND context_deleted=FALSE` (par exemple créée après la soft-delete ? cas rare)

**Assertion**
- Le `UPDATE ... WHERE context_deleted=TRUE` ne touche pas cette conversation. Elle reste `FALSE`. Pas de side-effect indésirable.

---

### T29-DEL-11 — Le push échoue mais la DB est déjà commitée

**Simulation** : mock `send_push_to_user` pour lever une exception.

**Résultat attendu**
- HTTP 200 (la réponse ne dépend pas du succès push car fire-and-forget post-commit).
- DB : tag_points soft-deleted, conversations marked, pending_file_deletions insérés.
- Log d'erreur côté push_service.

---

### T29-DEL-12 — Images en format string JSON (edge `_parse_images`)

**Pré-conditions**
- `tag_points.images = '["url1","url2"]'` (TEXT JSON, pas JSONB list direct)

**Résultat attendu**
- `images_queued = 2` (parsing OK via `_parse_images`)
- 2 lignes INSERT dans `pending_file_deletions`

---

### T29-DEL-13 — Images vides

**Pré-conditions** : `tag_points.images = NULL` (ou `[]` ou `""`)

**Résultat attendu**
- `images_queued = 0`
- Aucun INSERT dans `pending_file_deletions`
- HTTP 200 toujours

---

## 🟤 Compatibilité stricte Python (bit-pour-bit)

### T29-COMPAT-01 — Réponse JSON identique

**Action** : `DELETE` + `REACTIVATE` sur 3 cas nominaux + 3 cas d'erreur.

**Assertion**
- Comparer la réponse JSON Java vs Python : **mêmes clés, même types, même ordre canonique**.
- Ordre clés : `success, deleted, point_id, conversations_marked, images_queued, members_notified, media_purge_scheduled_at` (DELETE).
- Ordre clés REACTIVATE : `success, reactivated, point_id, media_purged, requires_media_reupload, pending_deletions_cancelled`.

---

### T29-COMPAT-02 — Message d'erreur string exact

| Code | Message attendu (bit-pour-bit) |
|---|---|
| 404 | `"SpotYou introuvable"` |
| 409 delete | `"Ce SpotYou est déjà supprimé"` |
| 409 reactivate | `"Ce SpotYou est déjà actif"` |
| 403 | `"Non autorisé"` |

**Assertion** : `error.detail == "<exact>"` — pas de reformulation, pas de traduction, pas de suffixe.

---

### T29-COMPAT-03 — Format timestamp ISO-8601

**Action** : DELETE sur un SpotYou.

**Assertion**
- `media_purge_scheduled_at` format : `YYYY-MM-DDTHH:mm:ss.ssssss+HH:mm` (microsecondes, offset).
- Exemple valide : `"2026-07-19T14:22:35.812000+00:00"`.
- Pas de `Z` (Java `ZoneOffset.UTC.toString() == 'Z'` — à forcer en `+00:00` ou utiliser un custom formatter).

---

### T29-COMPAT-04 — Payload push JSON exact

**Action** : DELETE + intercepter l'appel à `push_service.send_push_to_user`.

**Assertion** : payload sérialisé identique à Python :
- Keys présentes : `type, point_id, sender_id, sender_name, sender_picture, action_text, content_title, image_url`.
- `sender_picture = ""` si caller n'a pas de picture (pas `null`, pas manquant).
- `image_url` : résultat de `_first_image(tp.images)` — peut être `null` si 0 image.

---

### T29-COMPAT-05 — `title_str` logique

| Cas | title_str DELETE | title_str REACTIVATE |
|---|---|---|
| `tp.title = "Mon SpotYou"` | `"Mon SpotYou"` | `"Mon SpotYou"` |
| `tp.title = ""` (string vide) | `"SpotYou"` (fallback `or`) | `"SpotYou"` |
| `tp.title = None` | `"SpotYou"` | `"SpotYou"` |
| `tp.title = "A" * 80` (80 chars) | `"AAAA...A"` (80 chars — **PAS tronqué**) | `"AAAA...A"` (50 chars **tronqué**) |

**Assertion** : la troncature 50 chars N'EST appliquée qu'à REACTIVATE (ligne 407).

---

## 🟡 Cas limite / stress

### T29-STRESS-01 — SpotYou avec 100 images

**Résultat attendu** : `images_queued = 100`, 100 INSERT `ON CONFLICT DO NOTHING`. Latence acceptable (< 2s).

---

### T29-STRESS-02 — SpotYou avec 10 000 membres

**Résultat attendu**
- `members_notified = 9999` (exclu owner).
- 9999 `create_task` déclenchés. L'endpoint retourne avant que tous les push soient partis (fire-and-forget).
- Test manuel : vérifier que 9999 push arrivent dans les X minutes qui suivent.
- Pas de timeout HTTP côté client.

---

### T29-STRESS-03 — Concurrence : deux DELETE simultanés

**Setup** : 2 requêtes DELETE identiques arrivent en même temps (même owner).

**Résultat attendu**
- Une des deux gagne → 200.
- L'autre → 409 "Ce SpotYou est déjà supprimé" (ou 200 si la requête passe le guard avant que la première commit, cas rare).

**Assertion DB finale**
- `tag_points` soft-deleted une seule fois (pas de double write).
- `pending_file_deletions` : N images (pas 2N grâce à `ON CONFLICT DO NOTHING`).
- Push envoyés : potentiellement 2× N pour les membres (si les deux requêtes passent leur SELECT members) — **limitation connue du modèle Python**, à documenter pour la compat Java (ne PAS sur-corriger sauf demande explicite).

---

## Matrice de couverture

| Endpoint | Nominal | Auth | 404 | 409 | 403 | Idemp. | Side-effects | Compat |
|---|---|---|---|---|---|---|---|---|
| DELETE | T29-DEL-01,02 | T29-DEL-03,04 | T29-DEL-05 | T29-DEL-06,08 | T29-DEL-07 | T29-DEL-09 | T29-DEL-10,11,12,13 | T29-COMPAT-01..05 |
| REACTIVATE | T29-REA-01,02,03 | T29-REA-04 | T29-REA-05 | T29-REA-06,08 | T29-REA-07 | T29-REA-09 | T29-REA-10 | T29-COMPAT-01..05 |
| Stress | — | — | — | — | — | — | T29-STRESS-01,02,03 | — |

**Total : 30 cas de test minimum pour couvrir la slice.**

---

## Notes pour le futur runner de tests Java (ex. Cursor)

- Utiliser **Testcontainers PostgreSQL** + copie du schéma depuis les migrations 001–012.
- Stub `push_service` avec un mock qui enregistre les appels (vérifier count + payload).
- Seed minimum par test : 1 user owner, 1 SpotYou, 0..N membres `spot_you_members(status='accepted')`, 0..N conversations.
- Exécuter chaque test dans une transaction isolée (rollback à la fin) pour indépendance.
- Comparer les réponses JSON via `JSONAssert.assertEquals(expected, actual, STRICT)` — pas de `LENIENT` pour la compat.
