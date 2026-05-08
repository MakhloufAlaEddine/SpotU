# SLICE 46 — DB Mapping (Save / Unsave Services)

> **Source** : `/app/backend/routes/service_routes.py` l. 1107–1132 + `/app/backend/migrations/001_initial_schema.sql`

---

## 1. Tables impactées

| Table | POST /save | DELETE /unsave |
|-------|:----------:|:--------------:|
| `service_saves` | INSERT (ON CONFLICT DO NOTHING) | DELETE |
| `services` | SELECT (check existence + active) | — |

---

## 2. Schéma `service_saves`

```sql
CREATE TABLE public.service_saves (
    save_id     text NOT NULL,                       -- PK
    service_id  text,                                -- FK services ON DELETE CASCADE
    user_id     text,                                -- FK users    ON DELETE CASCADE
    saved_at    timestamptz DEFAULT now()
);

ALTER TABLE service_saves ADD CONSTRAINT service_saves_pkey
    PRIMARY KEY (save_id);

-- UNIQUE constraint anti-doublon (clé du ON CONFLICT)
ALTER TABLE service_saves ADD CONSTRAINT service_saves_service_id_user_id_key
    UNIQUE (service_id, user_id);

-- FKs
service_id → services(service_id)  ON DELETE CASCADE
user_id    → users(user_id)        ON DELETE CASCADE
```

### Colonnes

| Colonne | Type | POST | DELETE | Notes |
|---------|------|:----:|:------:|-------|
| `save_id` | text | INSERT (`new_id("svs")`) | — | PK générée |
| `service_id` | text | INSERT | WHERE | FK |
| `user_id` | text | INSERT | WHERE | FK |
| `saved_at` | timestamptz | DEFAULT NOW() | — | non updaté en cas d'ON CONFLICT |

> ⚠️ Le `save_id` est **toujours généré** côté serveur, **avant** la requête INSERT. Si l'INSERT déclenche ON CONFLICT, le `save_id` généré est **perdu** (pas réinjecté dans la ligne existante).

---

## 3. Requêtes SQL textuelles

### POST /save — Vérification existence
```sql
SELECT 1 FROM services
 WHERE service_id = $1 AND active = TRUE
```
> Filtre `active = TRUE` ⇒ inclut implicitement les services soft-deleted (`active=FALSE` après DELETE S43).

### POST /save — INSERT idempotent
```sql
INSERT INTO service_saves (save_id, service_id, user_id)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING
```
> `ON CONFLICT DO NOTHING` (sans target column) : se base sur **toute** contrainte unique violée. Ici, la contrainte `service_saves_service_id_user_id_key` (UNIQUE service_id + user_id) est la cible effective. Iso Python.

### DELETE /unsave — Suppression silencieuse
```sql
DELETE FROM service_saves
 WHERE service_id = $1 AND user_id = $2
```
> Pas de garde sur l'existence préalable. Si 0 ligne supprimée → réponse 200 quand même.

---

## 4. Contrainte UNIQUE & idempotence

### Contrainte
```sql
UNIQUE (service_id, user_id)
```
- Un utilisateur ne peut sauvegarder un service **qu'une seule fois**.
- Tentative de double-save → ON CONFLICT DO NOTHING (silent).

### Conséquences pour Java
- ⚠️ **NE PAS** simuler l'idempotence avec un `SELECT … LIMIT 1` puis `INSERT` séparés (risque de race condition).
- Utiliser **directement** la syntaxe `INSERT … ON CONFLICT DO NOTHING` de PostgreSQL.
- Côté JPA : préférer `JdbcTemplate` plutôt que `EntityManager.persist` pour bénéficier de la syntaxe native.

---

## 5. Transactions

### Comportement Python actuel
- **Aucun** `async with conn.transaction():` autour des opérations.
- Chaque endpoint = 1 ou 2 requêtes simples.

### Recommandation Java
- `@Transactional` **optionnel** (peu de valeur ajoutée pour 1 INSERT/DELETE).
- Si appliqué pour cohérence avec le reste du codebase, `PROPAGATION_REQUIRED`.

---

## 6. FKs & Cascades

| FK | Cible | Action |
|----|-------|--------|
| `service_id` | `services(service_id)` | `ON DELETE CASCADE` |
| `user_id` | `users(user_id)` | `ON DELETE CASCADE` |

### Conséquences
1. **Hard delete service** (`DELETE FROM services`) → favoris supprimés (CASCADE).
2. **Soft delete service S43** (`UPDATE services SET active=FALSE...`) → favoris **conservés** (pas de cascade).
3. **Hard delete user** (compte supprimé) → favoris supprimés (CASCADE).

> ⚠️ Asymétrie volontaire S43 : un service soft-deleted reste lié à ses favoris (utile pour nettoyage admin), mais ne peut plus être ajouté aux favoris (filtre `active=TRUE` du POST).

---

## 7. Index utiles

- PK `save_id` (B-tree). Peu utilisé en pratique.
- UNIQUE `(service_id, user_id)` — utilisé par INSERT (anti-doublon) et DELETE (lookup composite).
- ⚠️ Pas d'index dédié sur `user_id` seul ⇒ `GET /services/saved` (S42) WHERE `user_id = $1` peut scanner via l'index composite (préfixe `service_id` ⇒ pas optimal). Iso Python ; ne pas ajouter d'index sans mesure.

---

## 8. Concurrence

- **Pas de lock** dans le code Python.
- ON CONFLICT DO NOTHING gère le cas concurrent (deux POST simultanés du même user/service ⇒ 1 seul INSERT effectif).
- Pas de besoin SELECT FOR UPDATE.

---

## 9. Effets de bord SQL ordonnés

### POST /save
```
1. SELECT 1 FROM services WHERE service_id=$1 AND active=TRUE
2. (si trouvé) INSERT INTO service_saves ... ON CONFLICT DO NOTHING
```

### DELETE /unsave
```
1. DELETE FROM service_saves WHERE service_id=$1 AND user_id=$2
```

### Récap
- POST : 1 SELECT + 1 INSERT max.
- DELETE : 1 DELETE seul.
- Pas de read enrich, pas de jointure, pas de JSONB.
