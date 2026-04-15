# SLICE_23_BUSINESS_RULES.md — Règles métier
> Basé sur `auth_routes.py`, `auth_utils.py`, `models.py:60–88`.
> Généré le 2026-04-13.

---

## BR-01 — JWT_SECRET partagé Python/Java (CRITIQUE)

```
RÈGLE : Le JWT_SECRET utilisé par Java DOIT être IDENTIQUE à celui de Python.
        Sinon, les tokens émis par l'un ne seront pas décodables par l'autre.
        Cela casse immédiatement l'authentification au cutover.
SOURCE : auth_utils.py:10 — os.environ.get("JWT_SECRET")
PIÈGE : Si Java génère un nouveau secret au démarrage, TOUS les tokens existants
        deviennent invalides → déconnexion massive de tous les users.
EN JAVA : Lire le MÊME JWT_SECRET depuis les variables d'environnement.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-02 — Email toujours lowercase

```
RÈGLE : Tous les endpoints normalisent l'email en lowercase avant tout traitement.
        register: data.email.lower()
        login: data.email.lower()
        google: email.lower()
SOURCE : auth_routes.py:31,50,65.
EN JAVA : .toLowerCase() sur l'email AVANT la recherche DB.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-03 — Anti-enumeration (login)

```
RÈGLE : Le message d'erreur login est IDENTIQUE que l'email soit inconnu
        ou le password soit faux : "Invalid credentials".
        Cela empêche un attaquant de distinguer les deux cas.
SOURCE : auth_routes.py:52.
EN JAVA : Ne PAS retourner "User not found" et "Wrong password" séparément.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-04 — Nouveau user toujours role="user"

```
RÈGLE : register et google créent TOUJOURS un user avec role='user'.
        La promotion vers 'coach' ou 'admin' se fait via d'autres endpoints
        (become-coach, admin PUT role).
SOURCE : auth_routes.py:36 (register), 83 (google).
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-05 — Google OAuth écrase name + picture à chaque login

```
RÈGLE : Si un user existant se connecte via Google, son name ET picture
        sont écrasés par les valeurs Google. Les autres champs (bio, phone, etc.)
        ne sont PAS touchés.
SOURCE : auth_routes.py:72–74 — UPDATE SET name=$1, picture=$2.
ASYMÉTRIE : Un user qui a customisé son name via PUT /profile verra son name
            réinitialisé au prochain Google login. C'est le comportement Python actuel.
INCERTITUDE : Est-ce intentionnel ? Probablement un oversight. Reproduire tel quel.
NIVEAU DE CONFIANCE : CERTAIN (code explicite).
```

## BR-06 — Google user sans password → ne peut pas change-password

```
RÈGLE : Un user créé via Google n'a pas de password_hash (NULL en DB).
        S'il appelle PUT /change-password, verify_password("any", "") retourne false
        → 401 "Mot de passe actuel incorrect".
        Il n'y a PAS de flow "set initial password" pour les Google users.
SOURCE : auth_routes.py:111, auth_utils.py:26–28.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-07 — Dual token extraction (Header > Cookie)

```
RÈGLE : Le token est extrait en priorité du header Authorization: Bearer xxx.
        Si absent, le fallback est le cookie "winek_token".
        Le front envoie les deux simultanément.
SOURCE : auth_utils.py:61–65.
EN JAVA : Spring Security filter doit vérifier le header D'ABORD, puis le cookie.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-08 — JWT claims : user_id (pas sub)

```
RÈGLE : Le claim principal est "user_id" (pas le standard "sub").
        Le decode vérifie que "user_id" est présent (options.require).
SOURCE : auth_utils.py:33,47.
EN JAVA : Utiliser un claim custom "user_id" dans le JWT.
          NE PAS utiliser le claim standard "sub" (le front attend "user_id").
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-09 — JWT expiry : 7 jours

```
RÈGLE : Chaque token expire 7 jours après sa création.
        Il n'y a PAS de refresh token. Le front doit re-login après expiration.
SOURCE : auth_utils.py:17,36.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-10 — Rate limiting

```
RÈGLE : register et login sont limités à 5 requêtes/minute par IP.
        google est limité à 10 requêtes/minute par IP.
        Les autres endpoints auth (me, logout, change-password) ne sont PAS limités.
SOURCE : auth_routes.py:27,46,61.
EN JAVA : Implémenter un rate limiter équivalent (bucket4j, Resilience4j, ou intercepteur custom).
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-11 — Emergent OAuth protocol (Google)

```
RÈGLE : Le flow Google n'utilise PAS un id_token standard.
        Il utilise un session_id propriétaire Emergent :
        1. Front → Emergent OAuth UI → obtient session_id
        2. Front → POST /auth/google { session_id }
        3. Backend → GET https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data
                     Headers: { X-Session-ID: session_id }
        4. Emergent retourne { email, name, picture }
        5. Backend fait upsert + retourne { user, token }
SOURCE : auth_utils.py:110–132.
PIÈGE : Ce n'est PAS un flow Google standard (pas de vérification id_token côté backend).
        En Java : reproduire exactement l'appel HTTP vers Emergent.
        Alternative : vérifier directement l'id_token Google (plus standard mais DIFFÉRENT du Python).
        Recommandation : reproduire le flow Emergent pour compatibilité stricte.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-12 — Logout ne supprime rien

```
RÈGLE : POST /logout se contente de vérifier le token (require_auth)
        puis retourne { success: true }. Il ne supprime rien côté serveur
        (pas de session, pas de push token, pas de blacklist).
        L'invalidation est côté client uniquement (suppression du token local).
SOURCE : auth_routes.py:98–102.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-13 — Password validation Pydantic

```
RÈGLE : Le password doit faire au moins 6 caractères.
        La validation est faite par Pydantic (field_validator) AVANT le handler.
        Erreur 422 (pas 400) avec le format standard Pydantic validation error.
SOURCE : models.py:67–71.
EN JAVA : @Size(min = 6) dans le DTO ou validation manuelle → 422.
PIÈGE : Le front s'attend à un format d'erreur Pydantic (422 avec "detail" array).
        En Java, reproduire ce format ou adapter le front.
NIVEAU DE CONFIANCE : CERTAIN.
```

---

## Interactions avec les Slices précédentes

| Slice | Composant | Interaction |
|---|---|---|
| S02 | GET /auth/me | S23 documente l'INFRA (require_auth, JWT), S02 documente la RÉPONSE |
| S03–S22 | Tous les endpoints protégés | Utilisent `require_auth()` / `require_role()` documentés ici |
| S21 | POST /subscribe | Utilise `require_auth` + accède à `user["user_id"]` du JWT |
| S19–S22 | Stripe flows | Dépendent du user_id JWT pour l'authentification |
