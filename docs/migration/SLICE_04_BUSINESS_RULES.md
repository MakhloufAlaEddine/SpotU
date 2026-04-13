# SLICE_04_BUSINESS_RULES.md — Règles métier
> Basé sur `user_routes.py:99–235`, `spot_you_routes.py:27–109`.
> Généré le 2026-02-XX.

---

## RG-01 — Auth optionnelle : ne jamais retourner 401

**Source :** `user_routes.py:103–107`

```python
try:
    me = await require_auth(request, pool)
    me_id = me["user_id"]
except Exception:
    me_id = None
```

Le endpoint est **public** : accessible sans token.
Si un token est présent mais invalide/expiré : `me_id = None`, l'endpoint continue sans erreur.
Le seul impact de l'absence de token : `is_following = False` systématiquement.

**En Java :**
- Configurer Spring Security pour autoriser cette route sans auth :
  `.requestMatchers(HttpMethod.GET, "/api/users/*/public").permitAll()`
- Récupérer `me_id` depuis `SecurityContextHolder` — null si non authentifié

---

## RG-02 — 404 si user_id inconnu

**Source :** `user_routes.py:116–117`

```python
if not row:
    raise HTTPException(status_code=404, detail="User not found")
```

Le seul code d'erreur possible est 404. Pas de 401, pas de 403.

---

## RG-03 — Masquage du téléphone

**Source :** `user_routes.py:120–122`

```python
if not user.get("show_phone"):
    user["phone"] = None
```

- `show_phone = True` → `phone` exposé tel quel (string ou null selon DB)
- `show_phone = False` → `phone` forcé à `null` dans la réponse, **même si renseigné en DB**

**Note :** `show_phone` lui-même est conservé dans la réponse (visible par le frontend).
Ne pas supprimer le champ `phone` — le retourner comme `null`.

---

## RG-04 — Masquage des reviews

**Source :** `user_routes.py:162–174`

```python
if user.get("show_reviews"):
    all_reviews = await conn.fetch(...)
    if all_reviews:
        user["avg_rating"] = round(sum(r["rating"] ...) / len(...), 1)
        user["review_count"] = len(all_reviews)
    else:
        user["avg_rating"] = None
        user["review_count"] = 0
else:
    user["avg_rating"] = None
    user["review_count"] = 0
```

| show_reviews | Nb reviews | avg_rating | review_count |
|---|---|---|---|
| `false` | peu importe | `null` | `0` |
| `true` | 0 | `null` | `0` |
| `true` | ≥ 1 | float arrondi 1 décimale | int |

**Différence clé avec Slice 03 :** Dans Slice 03 (`/api/users/me`), les reviews sont **toujours** calculées. Ici, elles sont **conditionnelles à `show_reviews`**.

---

## RG-05 — is_following : règle de visibilité

**Source :** `user_routes.py:135–142`

```python
if me_id and me_id != user_id:
    is_following = await conn.fetchval(
        "SELECT EXISTS(SELECT 1 FROM user_follows WHERE follower_id=$1 AND following_id=$2)",
        me_id, user_id
    )
    user["is_following"] = bool(is_following)
else:
    user["is_following"] = False
```

| Cas | is_following |
|---|---|
| Non authentifié | `false` |
| Consulte son propre profil (`me_id == user_id`) | `false` |
| Authentifié, consulte un profil différent | Vrai ou faux selon DB |

---

## RG-06 — Services : uniquement pour les coachs

**Source :** `user_routes.py:177–182`

```python
if user.get("role") == "coach":
    svcs = await conn.fetch(
        "SELECT ... FROM services WHERE coach_id = $1 AND active = TRUE",
        user_id
    )
    user["services"] = rows_to_list(svcs)
```

- `role == "coach"` → champ `services` **présent** dans la réponse (tableau vide possible si aucun service actif)
- `role != "coach"` → champ `services` **absent** de la réponse (pas `null`, pas `[]`)

**En Java :** Utiliser `@JsonInclude(Include.NON_NULL)` ou mapper conditionnel.
Ne pas sérialiser `services` si non-coach.

---

## RG-07 — Interests : enrichissement des coach_tags

**Source :** `user_routes.py:144–159`

Les `coach_tags` raw (tableau de tag_id strings) sont enrichis avec les détails de la table `tags`.

Protection contre le double-encodage JSONB :
```python
tag_ids = user.get("coach_tags") or []
if isinstance(tag_ids, str):
    try:
        tag_ids = _j.loads(tag_ids)
    except Exception:
        tag_ids = []
```

Si `coach_tags` est vide → `interests = []` (tableau vide, jamais null).

---

## RG-08 — tag_points : enrichissement en batch

**Source :** `user_routes.py:184–233`

- Max 20 tag_points actifs par profil, triés par `created_at DESC`
- Enrichissement en 3 requêtes batch (participants, going, votes)
- `is_full` : calculé applicativement : `maximum_participants IS NOT NULL AND going_count >= maximum_participants`

**Cas `maximum_participants = null` :** `is_full = false` (jamais full si pas de max défini).

---

## RG-09 — get_next_session_date : fuseau Paris obligatoire

**Source :** `spot_you_routes.py:27–109`

```python
from zoneinfo import ZoneInfo
paris = ZoneInfo('Europe/Paris')
now_paris = datetime.now(paris)
today = now_paris.date()
```

- La comparaison "aujourd'hui" utilise le fuseau Europe/Paris
- Convention weekday : `0 = Lundi … 6 = Dimanche` (identique Python `weekday()`)
- Pour `event_schedule` (weekly) : retourne la prochaine occurrence >= now_paris
- Pour `event_date` (one-shot) : retourne la date si >= aujourd'hui, sinon `null`
- Si aucune séance future → `null`

**En Java :** Utiliser `ZoneId.of("Europe/Paris")` et `LocalDate.now(paris)`.

---

## Différences vs Slice 03 (`GET /api/users/me`)

| Règle | Slice 03 `/api/users/me` | Slice 04 `/api/users/{id}/public` |
|---|---|---|
| Auth | **Obligatoire** | **Optionnelle** |
| Colonnes DB | USER_FIELDS (18) | 13 colonnes distinctes |
| Email exposé | OUI | **NON** |
| Language exposé | OUI | **NON** |
| created_at exposé | OUI | **NON** |
| IBAN/BIC exposés | OUI | **JAMAIS** |
| Phone masqué | Non (toujours) | OUI (show_phone) |
| Reviews conditionnelles | Non (toujours) | OUI (show_reviews) |
| cover_picture | NON | **OUI** |
| followers/following | NON | **OUI** |
| is_following | NON | **OUI** |
| interests | NON | **OUI** |
| services | NON | **OUI (si coach)** |
| tag_points | NON | **OUI (max 20)** |
| Requêtes DB | 3 | **11 (dont 5 conditionnelles)** |

---

## Champs jamais exposés dans ce endpoint

Ces champs sont en DB mais **ne doivent PAS apparaître** dans la réponse :
```
email, language, sports_level, goals, user_roles, onboarding_done
updated_at, created_at
iban, bic, iban_name
password_hash, encrypted_password
stripe_customer_id, stripe_account_id
deleted_at, deleted_by, anonymized_at
```

---

## Niveau de confiance

| Règle | Confiance | Source |
|---|---|---|
| RG-01 Auth optionnelle | HAUTE | Code try/except lu directement |
| RG-02 404 si absent | HAUTE | Code explicite ligne 116 |
| RG-03 Phone masqué | HAUTE | Code explicite lignes 120–122 |
| RG-04 Reviews conditionnelles | HAUTE | Code explicite lignes 162–174 |
| RG-05 is_following | HAUTE | Code explicite lignes 135–142 |
| RG-06 Services coach only | HAUTE | Code explicite lignes 177–182 |
| RG-07 Interests enrichis | HAUTE | Code explicite lignes 144–159 |
| RG-08 is_full calcul | HAUTE | Code explicite lignes 230–231 |
| RG-09 Fuseau Paris | HAUTE | Code `spot_you_routes.py:35–38` vérifié |
