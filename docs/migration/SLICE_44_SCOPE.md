# SLICE 44 — Services Coach : Slots / Disponibilités

> **Statut** : À implémenter en Java/Spring Boot
> **Source unique de vérité** :
> - `/app/backend/routes/service_routes.py` (lignes 122–140 read helper, 826–842 create, 950–977 update)
> - `/app/backend/models.py` (lignes 219–242 — `DaySlotPayload`, `ServiceSlotItem`)
> - `/app/backend/routes/booking_routes.py` (transitions `slot_status`)
> - `/app/backend/expiry_worker.py` (transitions `slot_status` → `available` sur expiry)
> **Domaine** : Services Coach — sous-domaine slots/disponibilités
> **Précédentes slices** : S42 (Reads) ✅, S43 (CRUD principal) ✅

---

## 1. Constat factuel

⚠️ **Le backend Python n'expose AUCUN endpoint dédié slots / disponibilités.** Toute la logique de persistance des slots passe **uniquement** par les endpoints `POST/PUT/PATCH /api/services` documentés en S43.

Cette slice **ne crée donc pas de nouveau endpoint HTTP**. Elle documente la **logique de persistance et de cycle de vie des slots** qui était volontairement reportée en S43, afin que le futur backend Java soit fonctionnellement complet pour permettre la **réservation** d'un service.

---

## 2. Objectif

Rendre les services réellement **réservables** côté Java en complétant les endpoints S43 par la persistance correcte des slots :

1. **Création slots** lors de `POST /api/services` (champ `slots: ServiceSlotItem[]`).
2. **Replace slots** lors de `PUT/PATCH /api/services/{id}` (sémantique destructive : `null=keep`, `[]=wipe`, `[…]=replace`).
3. Documentation de référence sur la **state machine `slot_status`** (déjà gérée en S30/expiry_worker) pour que le développeur Java comprenne comment les slots sont consommés en aval.

---

## 3. Endpoints concernés

| Endpoint | Couverture S43 | Couverture S44 |
|----------|----------------|----------------|
| `POST /api/services` | Service principal + locations | **+ persistance `data.slots[]`** (legacy slots) |
| `PUT /api/services/{id}` | Service principal + locations | **+ replace `data.slots[]`** (DELETE all + INSERT all) |
| `PATCH /api/services/{id}` | Idem PUT | Idem |

> ⚠️ Pas d'endpoint nouveau. Le contrat HTTP reste identique à S43 ; seule la logique métier liée à `slots[]` est ajoutée.

---

## 4. **HORS scope** de S44

| Élément | Slice cible | Justification |
|---------|-------------|---------------|
| Slots imbriqués dans `data.packages[].slots[]` | **S45 — Services Packages** | Même table `service_slots` mais avec `package_id` non-null ; couplé au cycle de vie d'un package. |
| State machine `slot_status` (transitions `available → pending/reserved/booked/completed`) | **S30 — Booking create + pay** ✅ déjà migrée | Documenté ici uniquement en référence pour cohérence ; aucune ligne à écrire dans S44. |
| Worker d'expiry (transition `slot_status → available` sur booking expiré) | **Slice expiry_worker** ✅ déjà migrée | Idem référence uniquement. |
| Endpoints standalone slots (`POST /slots`, `PUT /slots/{id}`, `DELETE /slots/{id}`) | **N/A** | N'existent pas en Python ; ne PAS les inventer. |
| Endpoint `GET /api/services/{id}/slots` standalone | **N/A** | N'existe pas. La lecture passe par `GET /services/{id}` (S42, helper `_get_service_slots`). |
| Lecture des slots disponibles | **S42 ✅ déjà migrée** | Helper `_get_service_slots` migré en S42. |

---

## 5. Fichiers Python concernés

| Fichier | Lignes | Rôle |
|---------|--------|------|
| `/app/backend/routes/service_routes.py` | 122–140 | `_get_service_slots` (lecture, S42) |
| `/app/backend/routes/service_routes.py` | 826–842 | INSERT slots dans `create_service` |
| `/app/backend/routes/service_routes.py` | 949–977 | DELETE + INSERT slots dans `update_service` (replace) |
| `/app/backend/models.py` | 219–242 | `DaySlotPayload`, `ServiceSlotItem` |
| `/app/backend/migrations/001_initial_schema.sql` | 313–331 | Schéma table `service_slots` |
| `/app/backend/routes/booking_routes.py` | 259, 353, 495, 519, 720, 872, 1016 | Mutations `slot_status` (référence) |
| `/app/backend/expiry_worker.py` | 116 | Mutation `slot_status` (référence) |

> **Aucune modification** ne doit être apportée à ces fichiers — strict mode documentation-only.

---

## 6. Auth & Permissions (héritées de S43)

| Action | Auth | Permission |
|--------|------|------------|
| Créer slots via `POST /services` | JWT requis | Rôle ∈ {coach, admin} |
| Update slots via `PUT/PATCH /services/{id}` | JWT requis | Owner OR admin |

> Aucun contrôle additionnel propre aux slots. Si l'utilisateur peut écrire sur le service, il peut écrire les slots associés.

---

## 7. Dépendances

### Côté Java (déjà en place ou requises)
- **S43** doit être fusionnée d'abord : S44 modifie le comportement des mêmes endpoints `POST/PUT/PATCH /services`.
- Repository `ServiceLocationsRepository` (S43) : nécessaire pour résoudre `location_index → location_id` lors de la création des slots.
- Repository `BookingsRepository` (S30) : utilisé en lecture par `_get_service_slots` (déjà migré S42, mentionné ici en référence uniquement).
- Pas de nouvelle dépendance externe.

### Données nécessaires
- Lecture séquentielle : après INSERT des locations, avant INSERT des slots, pour résoudre `location_index`.

---

## 8. Niveau de risque

🟠 **MOYEN-ÉLEVÉ**

| Risque | Impact |
|--------|--------|
| 🔴 Replace destructif sur `PUT` | `data.slots = []` supprime **tous** les slots (`DELETE FROM service_slots WHERE service_id = $1`). Si un slot a un booking actif, le NOT EXISTS du read helper masquera mais la donnée DB sera incohérente. |
| 🔴 `location_index` resolution | Le payload utilise un **index** dans `data.locations[]`. Si les locations sont remplacées dans le même PUT, l'index doit pointer vers la **NOUVELLE** liste insérée, pas l'ancienne. |
| 🟠 `days_of_week` vs `day_of_week` | Asymétrie compat : `day_of_week` (legacy) vs `days_of_week[]` (nouveau). Logique de fallback dans le code Python. |
| 🟠 Pas de validation de chevauchement de slots | Aucun check côté Python que deux slots `recurring` se chevauchent sur le même jour. À ne PAS ajouter côté Java. |
| 🟠 Pas de validation `start_time < end_time` | Aucun check Python. À ne PAS ajouter. |
| 🟢 `slot_status` toujours initialisé à `'available'` (default DB) | Pas d'override sur INSERT — le default colonne suffit. |

---

## 9. Justification du choix

1. **Sans S44, les services créés en Java seraient `inchargeable`** : pas de slot inséré ⇒ les acheteurs ne peuvent pas réserver un créneau.
2. **Compléter S43** : les payloads `POST/PUT` acceptaient déjà `slots[]` (parité contrat), mais leur traitement était stub. S44 active réellement l'écriture.
3. **Découpe propre** : packages restent dans S45 (même table, mais sémantique « offre tarifaire » ≠ slot direct).
4. **Réutilisation maximale S43** : zéro nouveau endpoint, zéro nouveau DTO (`ServiceSlotItem` déjà accepté en S43). C'est uniquement de la **logique de persistance** ajoutée dans le service Java existant.

---

## 10. Critères de Done

- [ ] `POST /api/services` insère bien `data.slots[]` dans `service_slots` avec résolution `location_index` correcte.
- [ ] `PUT /api/services/{id}` avec `slots != null` exécute `DELETE FROM service_slots WHERE service_id = ?` puis `INSERT × N`.
- [ ] `PUT /api/services/{id}` avec `slots = null` (champ absent ou explicit null) ne touche **pas** la table `service_slots`.
- [ ] `PUT /api/services/{id}` avec `slots = []` supprime tous les slots du service (sans INSERT).
- [ ] La résolution `location_index` utilise les **nouvelles** locations si `data.locations != null`, sinon les locations existantes triées par `created_at`.
- [ ] `days_of_week` est sérialisé en JSONB.
- [ ] `day_of_week` (legacy) est rempli automatiquement à `days_of_week[0]` ou `null` si vide.
- [ ] `slot_type` accepte les 3 valeurs : `recurring`, `single`, `availability`.
- [ ] Le read helper `_get_service_slots` (déjà migré S42) renvoie cohérent après écriture.
- [ ] Tests d'intégration TC-S44-* tous verts (cf. `SLICE_44_TEST_CASES.md`).
- [ ] Aucun endpoint HTTP supplémentaire exposé.
