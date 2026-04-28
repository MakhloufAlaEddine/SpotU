# SLICE_38_API_CONTRACTS.md — Contrats Marketplace Products
> Basé sur `routes/marketplace_routes.py:1–267`.
> Généré le 2026-04-28.

---

## Endpoint — `GET /api/marketplace/products`

### Auth
**PUBLIC.** Pas de `require_auth`. Aucun token requis.

### Query params (tous optionnels)

| Param | Type | Défaut | Description |
|---|---|---|---|
| `tag_ids` | string CSV | `null` | Liste de tags séparés par `,` (ex: `tag1,tag2`). Trim + filtre vides. |
| `spotyou_id` | string | `null` | ID d'un `tag_points` (SpotYou). Si présent, résout `owner_id`, GPS, et tags si pas fournis. |
| `user_lat` | float | `null` | Latitude position user (calcul `dist_from_user`). |
| `user_lng` | float | `null` | Longitude position user. |

### Body
Aucun (GET).

### Pipeline backend

```
1. Parse tag_ids CSV → list[str]
2. Si spotyou_id : SELECT tag_points → owner_id, slat, slng, raw_tags
   - Si pas de tags fournis → utiliser tag_points.tag_ids
3. SELECT products WHERE tag_ids && $tags AND status='active'
   ORDER BY CASE WHEN seller_id=owner_id THEN 0 ELSE 1 END, created_at DESC
   (LIMIT 20 si pas de tags ni spotyou_id)
4. Si filter_requested ET tags vide après resolve → products=[]
5. Si tags présents : SELECT services WHERE active AND tag_ids ?| $tags
   ORDER BY CASE WHEN coach_id=owner_id THEN 0 ELSE 1 END, created_at DESC LIMIT 20
6. Pour chaque product:
   - p["item_type"]="product", p["price"]=float
   - Si lat+lng : is_physical=true ; calcule dist_from_spotyou (si SpotYou GPS) + dist_from_user
   - badge_type/badge_label : "owner" / "other"
7. Pour chaque service:
   - s["item_type"]="service", s["is_physical"]=false, s["price"]=float
   - Désérialise images (json.loads si string)
   - Désérialise tag_ids (json.loads si string)
   - badge_type/label
8. Merge: owner_items + other_items
9. seller_stats : 4 SELECT en parallèle (ratings/products/services/spotyou)
10. return {"products": items, "count": N}
```

### Réponse 200 (exemple)

```json
{
  "products": [
    {
      "item_type": "product",
      "product_id": "prod_xxx",
      "product_type": "physical_for_sale",
      "status": "active",
      "title": "VTT Tout-suspendu",
      "description": "...",
      "short_description": "VTT 27.5 pouces",
      "price": 850.00,
      "currency": "EUR",
      "pricing_type": "fixed",
      "pricing_modes": ["sale"],
      "price_per_hour": null,
      "price_per_day": null,
      "price_per_week": null,
      "price_per_month": null,
      "price_per_session": null,
      "image_url": "https://...",
      "image_urls": ["https://...", "https://..."],
      "cover_image_url": "https://...",
      "tag_ids": ["sport_outdoor", "vtt"],
      "seller_id": "u_seller",
      "seller_type": "private",
      "condition_label": "Excellent état",
      "category": "sport",
      "subcategory": "vtt",
      "skill_level": "intermediate",
      "lat": 48.8566,
      "lng": 2.3522,
      "city": "Paris",
      "location_privacy": "exact",
      "related_spotyou_ids": [],
      "delivery_modes": ["pickup", "shipping"],
      "pickup_type": "in_person",
      "pickup_notes": "Métro Bastille",
      "deposit_required": false,
      "deposit_amount": null,
      "available_quantity": 1,
      "in_stock": true,
      "included_items": ["pédales", "selle"],
      "availability_note": null,
      "cancellation_rules": null,
      "return_rules": null,
      "admin_comment": null,
      "created_at": "2026-04-20T11:37:13.540123+00:00",
      "updated_at": "2026-04-25T08:00:00.000000+00:00",
      "seller_name": "Alice",
      "seller_picture": "https://...",
      "seller_picture_url": "https://...",
      "is_physical": true,
      "dist_from_spotyou": 1.2,
      "dist_from_spotyou_fmt": "1.2 km",
      "dist_from_user": 0.3,
      "dist_from_user_fmt": "300 m",
      "badge_type": "other",
      "badge_label": "Alice",
      "seller_stats": {
        "rating_avg": 4.8,
        "rating_count": 12,
        "products_count": 5,
        "services_count": 0,
        "spotyou_count": 2
      }
    },
    {
      "item_type": "service",
      "service_id": "svc_yyy",
      "coach_id": "u_coach",
      "title": "Cours VTT initiation",
      "description": "...",
      "price": 50.00,
      "duration_min": 60,
      "images": ["https://..."],
      "tag_ids": ["vtt", "coaching"],
      "location_description": "Forêt de Fontainebleau",
      "address": "...",
      "coach_name": "Bob",
      "coach_picture": "https://...",
      "is_physical": false,
      "badge_type": "owner",
      "badge_label": "Créateur du SpotYou",
      "seller_stats": {
        "rating_avg": 4.5,
        "rating_count": 8,
        "products_count": 0,
        "services_count": 3,
        "spotyou_count": 1
      }
    }
  ],
  "count": 2
}
```

### Champs `seller_picture` vs `seller_picture_url`

⚠️ Le SELECT contient `u.picture AS seller_picture` ET `u.picture AS seller_picture_url`. **Ces 2 champs sont identiques** mais retournés deux fois (legacy compat front). **Reproduire**.

### Cas liste vide

```json
{ "products": [], "count": 0 }
```

HTTP 200. Pas 404.

### Réponse 200 sans paramètres (mode "feed")

20 produits actifs récents triés `created_at DESC`. Aucun service. Aucun calcul distance (pas de GPS spotyou ni user). Aucun badge owner.

### Erreurs

| Code | Cas | Body |
|---|---|---|
| 200 | Toujours en cas de succès (même liste vide) | structure ci-dessus |
| 200 | `spotyou_id` invalide → owner_id=null, retourne [] | `{"products":[], "count":0}` |
| 422 | Query param `user_lat` non parsable en float | FastAPI default validation error |
| 500 | DB indisponible / PostGIS absent | (FastAPI default) |

> ⚠️ **Pas de 400/401/403/404** dans les cas normaux. Endpoint très tolérant.

### Effets de bord

**AUCUN.** Lecture pure.

---

## Champs item — synthèse

### Champs communs (product + service)

| Champ | Source | Always present |
|---|---|---|
| `item_type` | applicatif | OUI (`"product"` ou `"service"`) |
| `price` (float) | DB Decimal cast | OUI si non-null |
| `is_physical` | applicatif | OUI |
| `badge_type` | applicatif | OUI (`"owner"` / `"other"`) |
| `badge_label` | applicatif | OUI |
| `seller_stats` | applicatif (4 queries parallèles) | OUI si seller_id/coach_id présent |

### Champs spécifiques produit (uniquement si product)

`product_id, product_type, status, title, description, short_description, currency, pricing_type, pricing_modes, price_per_hour, price_per_day, price_per_week, price_per_month, price_per_session, image_url, image_urls, cover_image_url, tag_ids, seller_id, seller_type, condition_label, category, subcategory, skill_level, lat, lng, city, location_privacy, related_spotyou_ids, delivery_modes, pickup_type, pickup_notes, deposit_required, deposit_amount, available_quantity, in_stock, included_items, availability_note, cancellation_rules, return_rules, admin_comment, created_at, updated_at, seller_name, seller_picture, seller_picture_url, dist_from_spotyou (si applicable), dist_from_spotyou_fmt, dist_from_user (si applicable), dist_from_user_fmt`

### Champs spécifiques service (uniquement si service)

`service_id, coach_id, title, description, duration_min, images, tag_ids, location_description, address, coach_name, coach_picture`

> ⚠️ **Pas** de `lat`, `lng`, `city`, `dist_*` côté service (toujours `is_physical=false`).

---

## Format `fmt_dist`

| Distance | Format |
|---|---|
| 0.3 km | `"300 m"` (int * 1000) |
| 0.7 km | `"700 m"` |
| 1 km exactement | **À VÉRIFIER** : code Python `if km < 1` → `"1.0 km"` (cas limite, on tombe dans else) |
| 1.2 km | `"1.2 km"` |
| 12.34 km (round à 12.3) | `"12.3 km"` |

Format Python : `f"{int(km*1000)} m"` ou `f"{km:.1f} km"`. Locale-independent (point décimal).

---

## Mode "feed" sans paramètres

```http
GET /api/marketplace/products
```

Renvoie 20 produits récents actifs, sans services, sans badges spéciaux, sans distances. C'est le **mode par défaut** pour la home page.

---

## Compatibilité format de réponse

| Aspect | Python | Java doit reproduire |
|---|---|---|
| Wrapper `{"products": [...], "count": N}` | OUI | ✅ (différent de S34 qui retournait directement liste) |
| Toutes colonnes products présentes | OUI | ✅ pas de filtrage |
| `seller_picture` ET `seller_picture_url` (doublon) | OUI | ✅ legacy |
| Format datetime `+00:00` | OUI | ✅ (compat S34) |
| `price` float (pas string) | OUI | ✅ |
| Distance `0.3` round à 1 décimale | OUI | ✅ |
| `tag_ids` TEXT[] côté product (déjà array) | OUI | ✅ |
| `tag_ids` services désérialisé si string | OUI | ✅ |
| `images` services désérialisé si string | OUI | ✅ |
| Owner-first sorting | OUI | ✅ |
| Pas de pagination | OUI | ✅ |
