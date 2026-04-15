# SLICE_24_BUSINESS_RULES.md — Règles métier
> Basé sur `user_routes.py`, `upload_routes.py`, `push_routes.py`, `r2_storage.py`.
> Généré le 2026-04-15.

---

## BR-01 — PUT /profile : UPDATE dynamique avec CLEARABLE_FIELDS

```
RÈGLE : Le body est partiel (model_dump(exclude_unset=True)).
        - Champ présent + valeur non-null → SET à la valeur
        - Champ présent + valeur null + dans CLEARABLE_FIELDS → SET à NULL (efface)
        - Champ présent + valeur null + PAS dans CLEARABLE_FIELDS → IGNORÉ
        - Champ absent → IGNORÉ
        CLEARABLE_FIELDS = {iban, bic, iban_name, bio, phone, picture}
SOURCE : user_routes.py:39–45.
EN JAVA : Utiliser @JsonInclude(NON_NULL) avec un Map<String,Object> ou un DTO custom
          qui distingue "absent" de "null explicite".
PIÈGE : Jackson Java traite absent et null de la même façon par défaut.
        Utiliser Optional<String> ou un wrapper pour distinguer.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-02 — PUT /profile : JSONB fields cast

```
RÈGLE : Les champs coach_tags, goals, user_roles sont des listes (JSONB en DB).
        Le SQL dynamique ajoute ::jsonb au SET pour ces champs.
        asyncpg gère la sérialisation list → JSONB nativement.
SOURCE : user_routes.py:65–69.
EN JAVA : Utiliser un JPA converter ou passer la liste comme JSON string
          avec un cast natif. Ou @Type(JsonType.class) Hibernate.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-03 — PUT /profile : suppression ancienne photo

```
RÈGLE : Si le champ picture est modifié ET que l'ancienne valeur est non-null
        ET différente de la nouvelle → delete_upload_file(old_picture).
        Cela supprime l'ancienne image en R2 ou en local.
SOURCE : user_routes.py:57–60.
EN JAVA : Appeler le service de suppression APRÈS l'UPDATE DB (fire-and-forget).
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-04 — PUT /profile : body vide → retourne le user sans UPDATE

```
RÈGLE : Si aucun champ valide n'est fourni (update_fields vide après filtrage),
        le endpoint retourne le user actuel SANS exécuter d'UPDATE.
SOURCE : user_routes.py:53–54.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-05 — POST /become-coach : transition unidirectionnelle

```
RÈGLE : Seul role='user' peut devenir 'coach'. Un 'coach' ou 'admin' reçoit 400.
        La transition inverse (coach→user) n'existe PAS dans le code.
        is_coach_verified reste false après become-coach (vérification admin séparée).
SOURCE : user_routes.py:88–89.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-06 — PATCH /cover : ownership strict

```
RÈGLE : Le path param {user_id} DOIT correspondre à l'utilisateur connecté.
        Sinon → 403 "Accès refusé."
SOURCE : user_routes.py:530–531.
ASYMÉTRIE : PUT /profile ne vérifie PAS l'ownership via path param (il update toujours le user connecté).
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-07 — Upload : magic bytes > Content-Type

```
RÈGLE : Le type de fichier est déterminé par les MAGIC BYTES, pas par le Content-Type
        envoyé par le client. Cela empêche les injections de fichiers non-image.
SOURCE : upload_routes.py:44–63.
FORMATS : JPEG, PNG, GIF, WebP, HEIC.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-08 — Upload : compression Pillow avant stockage

```
RÈGLE : Les images sont compressées via Pillow (r2_storage.compress_image) AVANT upload.
        HEIC est converti en JPEG. Les images > seuil sont redimensionnées.
        Si Pillow/r2_storage n'est pas disponible → fallback sans compression.
SOURCE : upload_routes.py:167–177.
EN JAVA : Utiliser ImageIO ou Thumbnailator pour la compression.
          HEIC nécessite une librairie dédiée (ex: TwelveMonkeys ImageIO).
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-09 — Upload : R2 avec fallback filesystem local

```
RÈGLE : Si R2 est configuré (is_r2_configured()) → upload en R2.
        Si R2 échoue (exception) → fallback filesystem local (/app/backend/uploads/).
        L'URL retournée diffère selon le stockage :
        - R2 : https://images.winek.app/{category}/{filename}
        - Local : {base_url}/api/uploads/{filename}
SOURCE : upload_routes.py:180–202.
EN JAVA : Reproduire le dual-storage. AWS SDK S3 pour R2 (compatible S3).
          Fallback : Spring Resource handler pour /api/uploads/.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-10 — Upload : taille max 15 Mo

```
RÈGLE : Le fichier est lu avec une limite de 15 Mo + 1 byte.
        Si le fichier dépasse → 413 "Fichier trop volumineux".
        La compression Pillow réduit ensuite la taille avant stockage.
SOURCE : upload_routes.py:27,150–155.
EN JAVA : spring.servlet.multipart.max-file-size=15MB
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-11 — Push token : format ExponentPushToken

```
RÈGLE : Le token doit commencer par "ExponentPushToken[".
        Sinon → 400 "Token Expo invalide".
SOURCE : push_routes.py:22–23.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-12 — Push token : transfert entre utilisateurs

```
RÈGLE : Si un token est déjà associé à un AUTRE user (changement de compte
        sur le même appareil) → l'ancienne association est désactivée (is_active=FALSE)
        et le token est réassocié au nouveau user via ON CONFLICT DO UPDATE.
SOURCE : push_routes.py:32–37,48–53.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-13 — Push token : soft-disable (pas de DELETE physique)

```
RÈGLE : DELETE /push-token ne supprime PAS la ligne.
        Il met is_active=FALSE. Le token reste en DB pour historique/audit.
SOURCE : push_routes.py:63–64.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-14 — delete_upload_file : distingue R2 vs local vs externe

```
RÈGLE : La suppression vérifie le préfixe de l'URL :
        - Commence par R2_PUBLIC_URL → delete en R2
        - Contient "/api/uploads/" → delete local
        - Sinon (Pexels, Unsplash, externe) → RIEN (ignoré silencieusement)
SOURCE : upload_routes.py:68–103.
SÉCURITÉ : La suppression locale vérifie le path traversal via .resolve().relative_to().
NIVEAU DE CONFIANCE : CERTAIN.
```
