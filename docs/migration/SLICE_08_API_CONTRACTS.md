# SLICE_08_API_CONTRACTS.md — Contrat d'API exact
> Basé sur `user_routes.py:238–259`.
> Généré le 2026-02-XX.

---

## ENDPOINT — GET /api/users/{user_id}/reviews

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `GET` |
| Chemin Python | `/api/users/{user_id}/reviews` |
| Chemin Java cible | `/api/users/{userId}/reviews` |
| Auth | **AUCUNE** — endpoint totalement public |
| Pagination | **NON** — toute la liste retournée |
| Tri | `ORDER BY r.created_at DESC` (plus récent en premier) |
| Handler | `get_user_reviews()` — `user_routes.py:238–259` |

### Path Parameters

| Paramètre | Type | Obligatoire | Note |
|---|---|---|---|
| `user_id` | `string` | OUI | L'utilisateur dont on veut les reviews |

### Query Params / Body

**Aucun.**

---

### Réponse — HTTP 200 : utilisateur avec reviews visibles

```json
[
  {
    "review_id": "rev_abc123",
    "rating": 5,
    "comment": "Excellent coach, très professionnel.",
    "created_at": "2026-04-10T14:30:00.000000+00:00",
    "reviewer_id": "user_xyz789",
    "reviewer_name": "Alice Martin",
    "reviewer_picture": "https://example.com/alice.jpg"
  },
  {
    "review_id": "rev_def456",
    "rating": 4,
    "comment": null,
    "created_at": "2026-03-20T09:15:00.000000+00:00",
    "reviewer_id": "user_ghi012",
    "reviewer_name": "Bob Dupont",
    "reviewer_picture": null
  }
]
```

### Réponse — HTTP 200 : show_reviews=false OU 0 reviews

```json
[]
```

*(HTTP 200 dans les deux cas — la liste vide ne distingue pas les deux situations)*

---

### Schéma d'un objet `ReviewItemDto`

| Champ | Type JSON | Type Java | Nullable | Source DB | Note |
|---|---|---|---|---|---|
| `review_id` | `string` | `String` | NON | `reviews.review_id` TEXT | Format `"rev_<hex>"` |
| `rating` | `number` | `int` | NON | `reviews.rating` INTEGER | Entre 1 et 5 (contrainte DB CHECK) |
| `comment` | `string\|null` | `String` | **OUI** | `reviews.comment` TEXT | Null si non renseigné |
| `created_at` | `string` | `String` | OUI | `reviews.created_at` TIMESTAMPTZ | ISO 8601 avec timezone — `row_to_dict` |
| `reviewer_id` | `string` | `String` | NON | `users.user_id` (alias `reviewer_id`) | Auteur de la review |
| `reviewer_name` | `string` | `String` | NON | `users.name` (alias `reviewer_name`) | |
| `reviewer_picture` | `string\|null` | `String` | **OUI** | `users.picture` (alias `reviewer_picture`) | URL ou null |

**Total : 7 champs par review.**

---

### Codes d'erreur

| Code HTTP | Condition | Corps | Source Python |
|---|---|---|---|
| `404` | `user_id` inexistant en DB | `{"detail": "User not found"}` | `user_routes.py:245–246` |
| `500` | DB inaccessible | Erreur FastAPI générique | Non géré explicitement |

**Note :** `show_reviews=false` → **HTTP 200 + `[]`** (pas 403, pas 404).

---

### Détail du flux exact

```python
# user_routes.py:238–259
@router.get("/{user_id}/reviews")
async def get_user_reviews(user_id: str):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT show_reviews FROM users WHERE user_id = $1", user_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        if not row["show_reviews"]:
            return []
        reviews = await conn.fetch(
            """SELECT r.review_id, r.rating, r.comment, r.created_at,
                      u.user_id as reviewer_id, u.name as reviewer_name, u.picture as reviewer_picture
               FROM reviews r
               JOIN users u ON u.user_id = r.reviewer_id
               WHERE r.reviewee_id = $1
               ORDER BY r.created_at DESC""",
            user_id
        )
        return rows_to_list(reviews)
```

**Note sur la sérialisation :** `rows_to_list` (database.py:68) applique `row_to_dict` à chaque ligne.
`row_to_dict` convertit `created_at` (TIMESTAMPTZ) via `.isoformat()` → string ISO 8601 avec timezone.
