# SLICE_28_TEST_CASES.md — Cas de tests
> Généré le 2026-04-19.

---

## A. POST /tag-points (Create)

| TC | Scénario | Résultat |
|---|---|---|
| TC-CR-01 | Création nominale (titre + lat/lng + tag_ids) | 200 + SpotYou complet via build_point_response(is_owner=true) |
| TC-CR-02 | Créateur auto-membre | DB: spot_you_members INSERT (owner, accepted) |
| TC-CR-03 | tag_ids vide → 400 | 400 "Au moins un tag est requis." |
| TC-CR-04 | images > 10 → 400 | 400 "Maximum 10 images autorisées" |
| TC-CR-05 | min > max participants → 400 | 400 "...ne peut pas dépasser le maximum." |
| TC-CR-06 | min sans max → auto-complétion | max_participants = min_participants |
| TC-CR-07 | min < 1 → forcé à 1 | minimum_participants = 1 (pas d'erreur) |
| TC-CR-08 | precision="100m" → coords brouillées | DB location != lat/lng envoyés |
| TC-CR-09 | precision="exact" → coords exactes | DB location == lat/lng envoyés |
| TC-CR-10 | Défauts visibilité/join/invite | visibility=public, join_mode=open, invite_perms=admin_only |
| TC-CR-11 | Auth absente → 401 | 401 |
| TC-CR-12 | Avec event_schedule JSONB | event_schedule stocké comme JSONB |

## B. PUT /tag-points/{id} (Update)

| TC | Scénario | Résultat |
|---|---|---|
| TC-UP-01 | Update titre nominal | 200 + titre mis à jour, updated_at changé |
| TC-UP-02 | Pas owner ni admin → 403 | 403 "Not authorized" |
| TC-UP-03 | Point inexistant → 404 | 404 |
| TC-UP-04 | Body vide → retour sans UPDATE | 200 + SpotYou actuel |
| TC-UP-05 | images > 10 → 400 | 400 |
| TC-UP-06 | tag_ids vidé (len 0) → 400 | 400 "Au moins un tag est requis." |
| TC-UP-07 | min > max → 400 | 400 |
| TC-UP-08 | Update location (lat+lng) → PostGIS SET | location mise à jour via ST_MakePoint |
| TC-UP-09 | JSONB tag_ids update | $N::jsonb dans SQL |
| TC-UP-10 | Images retirées → delete_upload_files | Anciennes URLs supprimées |
| TC-UP-11 | Aucun vrai changement → pas de notif | has_real_changes=false → pas de push |
| TC-UP-12 | Vrais changements + membres → notif push | Push "SpotYou mis à jour" à chaque membre |
| TC-UP-13 | SpotYou cancelled → pas de notif même si changements | is_cancelled=true → skip push |
| TC-UP-14 | Admin peut modifier n'importe quel SpotYou | 200 (role=admin bypass ownership) |
| TC-UP-15 | Auth absente → 401 | 401 |

## C. PATCH /tag-points/{id}/new-date

| TC | Scénario | Résultat |
|---|---|---|
| TC-ND-01 | Toggle false→true | 200 {new_date_coming: true} |
| TC-ND-02 | Toggle true→false | 200 {new_date_coming: false} |
| TC-ND-03 | Pas owner ni admin → 403 | 403 |
| TC-ND-04 | Point inexistant → 404 | 404 |

---

## Résumé

| Catégorie | Nombre |
|---|---|
| Create | 12 |
| Update | 15 |
| new-date | 4 |
| **TOTAL** | **31** |
