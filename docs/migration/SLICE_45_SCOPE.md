# SLICE 45 — Services Coach : Packages

> **Statut** : À implémenter en Java/Spring Boot
> **Source unique de vérité** :
> - `/app/backend/routes/service_routes.py` l. 143–169 (read), l. 794–811 (write POST), l. 519–545 (batch read /mine)
> - `/app/backend/models.py` l. 219–230 (`DaySlotPayload`, `ServicePackageItem`)
> - `/app/backend/migrations/001_initial_schema.sql` (schéma `service_packages`)
> **Domaine** : Services Coach — sous-domaine packages (formules tarifaires)
> **Précédentes slices** : S42 (reads) ✅, S43 (CRUD principal) ✅, S44 (slots) ✅

---

## 1. Constat factuel

⚠️ **Il n'existe AUCUN endpoint dédié packages côté Python**. La gestion des packages se fait **uniquement** via le payload `packages[]` de :

| Endpoint | Comportement Python |
|----------|---------------------|
| `POST /api/services` | INSERT × N dans `service_packages` + INSERT × M dans `service_slots` (type `'single'`, `package_id` set) |
| `PUT /api/services/{id}` | **AUCUNE logique packages**. `ServiceUpdate` n'expose PAS le champ `packages`. |
| `PATCH /api/services/{id}` | Idem PUT (même handler). |

⚠️ **Asymétrie majeure** : pour modifier les packages d'un service, le coach **doit supprimer puis recréer le service** côté Python. Aucun chemin update/delete/replace de packages standalone n'existe.

S45 documente :
1. La **persistance des packages** lors du `POST /api/services` (déclarée stub en S43).
2. La **persistance des slots imbriqués** dans chaque package (déclarée stub en S43/S44).
3. La **lecture** déjà migrée en S42 (référence uniquement).
4. L'**asymétrie PUT/PATCH** comme contrainte produit à conserver à l'identique.

---

## 2. Endpoints concernés

| Endpoint | Couverture S43 | Couverture S44 | Couverture S45 |
|----------|----------------|----------------|----------------|
| `POST /api/services` | service principal + locations | + slots legacy (`package_id=NULL`) | **+ packages + slots de packages (`package_id NOT NULL`)** |
| `PUT /api/services/{id}` | service principal | + slots replace | **rien à faire** — pas de logique packages |
| `PATCH /api/services/{id}` | idem PUT | idem PUT | idem PUT |

> ⚠️ Aucun nouvel endpoint HTTP. Aucun DTO HTTP supplémentaire (`ServicePackageItemDto` et `DaySlotPayloadDto` déjà acceptés en S43).

---

## 3. **HORS scope** de S45

| Élément | Slice cible / N/A | Justification |
|---------|-------------------|---------------|
| Endpoint `POST /services/{id}/packages` standalone | **N/A** | N'existe pas en Python. NE PAS créer. |
| Endpoint `PUT /packages/{pkg_id}` | **N/A** | N'existe pas. |
| Endpoint `DELETE /packages/{pkg_id}` | **N/A** | N'existe pas. |
| Update packages via `PUT /services/{id}` | **Asymétrie volontaire** | `ServiceUpdate` n'expose pas `packages`. Préserver. |
| Lecture packages (`_get_service_packages`, `_batch_enrich_services_for_owner`) | **S42 ✅** | Déjà migré. |
| Pricing engine (calcul `min(packages.price)` lors price-preview) | **S30 / S37 ✅** | Déjà migré. |
| State machine `slot_status` sur slots de packages | **S30 ✅** | Idem comportement legacy slots. |
| `pricing_rules`, `subscription_plans` admin | **Slice pricing admin (S33-S35)** | Hors domaine Services Coach. |

---

## 4. Fichiers Python concernés

| Fichier | Lignes | Rôle |
|---------|--------|------|
| `/app/backend/routes/service_routes.py` | 794–811 | INSERT packages + nested slots (POST) |
| `/app/backend/routes/service_routes.py` | 143–169 | `_get_service_packages` (read, S42) |
| `/app/backend/routes/service_routes.py` | 519–545 | `_fetch_packages` batch (read, S42) |
| `/app/backend/routes/service_routes.py` | 763–767 | Calcul `service_price = min(packages.price)` |
| `/app/backend/models.py` | 219–230 | `DaySlotPayload`, `ServicePackageItem` |
| `/app/backend/migrations/001_initial_schema.sql` | (table `service_packages`) | Schéma |

> **Aucune modification** ne doit être apportée à ces fichiers — strict mode documentation-only.

---

## 5. Auth & Permissions

| Action | Auth | Permission |
|--------|------|------------|
| Création packages via `POST /services` | JWT requis (S43) | Rôle ∈ {coach, admin} (S43) |
| Update packages | **N/A** — chemin inexistant côté Python |

> Aucun contrôle additionnel propre aux packages. Hérite intégralement des permissions S43.

---

## 6. Dépendances

### Java (déjà en place ou requises)
- **S43** doit être fusionnée : modifie le comportement de `POST /services`.
- **S44** doit être fusionnée : la persistance des slots de packages réutilise l'infra `ServiceSlotsRepository`.
- Repository `ServicePackagesRepository` (nouveau côté Java).
- Pas de nouvelle dépendance externe (R2, Stripe, etc.).

### Données nécessaires
- L'INSERT des packages doit se faire **avant** l'INSERT des slots de packages (FK).
- Ordre dans la transaction Java : services → packages → slots de packages → locations → slots legacy → enrich.

---

## 7. Niveau de risque

🟠 **MOYEN**

| Risque | Impact |
|--------|--------|
| 🔴 Asymétrie PUT/PATCH | `ServiceUpdate` ne contient PAS `packages` ⇒ aucune modification packages possible après création. À documenter dans le contrat Java/front sans permettre l'envoi du champ. |
| 🔴 Replace global slots S44 efface aussi slots de packages | `PUT /services` avec `data.slots=[]` (cf. BR-44.09) supprime **TOUS** les slots, y compris ceux des packages (`package_id NOT NULL`). Les packages se retrouvent sans slots, mais subsistent. **Iso Python** à conserver. |
| 🟠 Calcul `service_price` dérivé | Sur POST si `data.price=null`, `service_price = min((p.price for p in packages), default=0.0)`. À reproduire exactement (default 0, pas null). |
| 🟠 `slot_type='single'` forcé pour package slots | Hardcodé dans le code Python (l. 809 : `'single'` literal). Pas négociable au niveau payload. |
| 🟢 FK ON DELETE CASCADE service → packages | Hard delete service supprime les packages ; soft delete S43 ne déclenche PAS cette cascade. Iso. |
| 🟢 FK ON DELETE SET NULL package → service_slots | Si on supprime un package (action non implémentée en Python), les slots gardent `package_id=NULL`. Edge case sans chemin déclencheur. |

---

## 8. Justification du choix

1. **Compléter S43/S44** : avec S45, le `POST /api/services` est **fonctionnellement complet** côté Java et le coach peut créer un service avec formules tarifaires + créneaux.
2. **Iso-Python strict** : ne PAS introduire de chemin update/delete inexistant côté Python (préserver l'asymétrie produit).
3. **Réutilisation maximale** : `ServicePackageItemDto` et `DaySlotPayloadDto` déjà acceptés en S43 ; S45 active leur traitement.
4. **Cohérence lecture** : la réponse `service.packages[]` (S42) reflète immédiatement les données écrites.

---

## 9. Critères de Done

- [ ] `POST /api/services` insère `data.packages[]` dans `service_packages`.
- [ ] Pour chaque package, les `slots[]` (type `DaySlotPayload`) sont insérés dans `service_slots` avec `package_id` set, `slot_type='single'`.
- [ ] `service_price` calculé : `data.price` si fourni, sinon `min(packages.price)` ou `0.0`.
- [ ] `PUT/PATCH /api/services/{id}` **ignore** tout champ `packages` reçu (asymétrie Pydantic — DTO Java ne doit PAS exposer `packages` non plus).
- [ ] La réponse `POST /services` contient `packages[]` enrichi via `_get_service_packages` (S42).
- [ ] Les FK `service_packages.service_id → services` (CASCADE) et `service_slots.package_id → service_packages` (SET NULL) sont préservées.
- [ ] Tests d'intégration TC-S45-* tous verts (cf. `SLICE_45_TEST_CASES.md`).
- [ ] Aucun nouvel endpoint HTTP exposé.
- [ ] `@Transactional` couvre la création complète (déjà recommandé en S43).
