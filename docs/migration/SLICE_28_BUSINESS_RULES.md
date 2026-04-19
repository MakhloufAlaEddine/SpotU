# SLICE_28_BUSINESS_RULES.md — Règles métier
> Généré le 2026-04-19.

---

## BR-01 — Create : auto-membership owner
```
RÈGLE : Le créateur est AUTOMATIQUEMENT inséré comme membre accepted via ON CONFLICT DO NOTHING.
SOURCE : tagpoint_routes.py:1858–1860.
```

## BR-02 — Create : `randomize_for_storage` avant INSERT
```
RÈGLE : Si precision != "exact", les coordonnées sont décalées ALÉATOIREMENT (pas déterministe)
        AVANT stockage. Les coords en DB ne sont PAS les coords exactes de l'utilisateur.
        C'est DIFFÉRENT de apply_precision_offset (S26) qui s'applique à la lecture.
SOURCE : tagpoint_routes.py:1831, 118–137.
PIÈGE : En Java, reproduire le Random() sans seed (pas new Random(hash)).
```

## BR-03 — Create : tag_ids obligatoire (au moins 1)
```
RÈGLE : 400 si tag_ids est vide ou absent.
SOURCE : tagpoint_routes.py:1823–1824.
```

## BR-04 — Create/Update : max 10 images
```
RÈGLE : 400 si images.length > 10.
SOURCE : tagpoint_routes.py:1819–1820, 1917–1918.
```

## BR-05 — Create/Update : min/max participants auto-complétion
```
RÈGLE : Si min fourni sans max → max = min. Si max fourni sans min → min = max.
        Si min < 1 → forcé à 1. Si min > max → 400.
SOURCE : tagpoint_routes.py:1827–1840, 1925–1946.
```

## BR-06 — Update : owner OU admin plateforme
```
RÈGLE : 403 si l'utilisateur n'est NI le owner NI un admin (user.role == "admin").
SOURCE : tagpoint_routes.py:1908–1909.
```

## BR-07 — Update : body vide → retour sans UPDATE
```
RÈGLE : Si model_dump(exclude_unset=True) est vide → retour SpotYou actuel.
SOURCE : tagpoint_routes.py:1911–1914.
```

## BR-08 — Update : diff de valeurs `_vals_equal`
```
RÈGLE : Les notifications ne sont envoyées QUE si de vrais changements sont détectés.
        Comparaison spéciale : timestamps UTC, floats tolérance 1e-7, JSONB json.dumps sort_keys.
SOURCE : tagpoint_routes.py:1874–1894, 1948–1958.
```

## BR-09 — Update : SQL dynamique JSONB + location
```
RÈGLE : JSONB fields (tag_ids, images, event_schedule) → $N::jsonb dans le SET.
        Location → ST_SetSRID(ST_MakePoint($lng, $lat), 4326) si lat+lng fournis.
        NULL → "key = NULL" sans paramètre positionnel.
SOURCE : tagpoint_routes.py:1960–1984.
```

## BR-10 — Update : suppression images retirées
```
RÈGLE : Si 'images' est dans le body, les URLs présentes dans old_images mais absentes de
        new_images sont supprimées via delete_upload_files() (R2 ou local).
SOURCE : tagpoint_routes.py:1996–2001.
```

## BR-11 — Update : notification membres si changements
```
RÈGLE : Push "SpotYou mis à jour" envoyé à chaque membre (sauf owner) si :
        has_real_changes=True ET cancelled=False.
        Fire-and-forget (asyncio.create_task).
SOURCE : tagpoint_routes.py:2010–2028.
```

## BR-12 — new-date : toggle booléen
```
RÈGLE : new_val = NOT current value. Pas de body.
        Permission : owner OU admin.
SOURCE : tagpoint_routes.py:2046.
```

## BR-13 — Create : défauts visibilité/join/invite
```
RÈGLE : visibility_type défaut "public", join_mode défaut "open", invite_permissions défaut "admin_only".
SOURCE : tagpoint_routes.py:1854–1855.
```
