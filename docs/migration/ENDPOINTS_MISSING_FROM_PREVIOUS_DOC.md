# ENDPOINTS_MISSING_FROM_PREVIOUS_DOC.md
> Endpoints présents dans le code mais absents ou incorrects dans la documentation v1.
> Total : **104 lacunes** (absences + chemins incorrects)

---

## AUTH (1 manquant)

| # | Méthode | Path | Fichier:ligne | Raison |
|---|---------|------|--------------|--------|
| 1 | GET | `/api/auth/native-callback` | `auth_routes.py:14` | Non documenté |

---

## USERS (12 manquants)

| # | Méthode | Path | Fichier:ligne | Raison |
|---|---------|------|--------------|--------|
| 2 | GET | `/api/users/{user_id}/reviews` | `user_routes.py:238` | Non documenté |
| 3 | PUT | `/api/users/{user_id}/reviews/{review_id}` | `user_routes.py:262` | Non documenté |
| 4 | POST | `/api/users/{user_id}/reviews` | `user_routes.py:310` | Non documenté |
| 5 | GET | `/api/users/me/activity-feed` | `user_routes.py:377` | Non documenté |
| 6 | POST | `/api/users/{user_id}/follow` | `user_routes.py:494` | Non documenté |
| 7 | DELETE | `/api/users/{user_id}/follow` | `user_routes.py:512` | Non documenté |
| 8 | PATCH | `/api/users/{user_id}/cover` | `user_routes.py:525` | Non documenté |
| 9 | GET | `/api/users/{user_id}/followers` | `user_routes.py:568` | Non documenté |
| 10 | GET | `/api/users/{user_id}/following` | `user_routes.py:592` | Non documenté |
| 11 | DELETE | `/api/users/{user_id}/followers/{follower_id}` | `user_routes.py:616` | Non documenté |
| 12 | POST | `/api/users/{user_id}/block` | `user_routes.py:632` | Non documenté |
| 13 | DELETE | `/api/users/{user_id}/block` | `user_routes.py:654` | Non documenté |
| 14 | GET | `/api/users/{user_id}/suggestions` | `user_routes.py:667` | Non documenté |

---

## PUSH (2 chemins incorrects)

| # | Méthode | Path réel | Chemin en doc v1 | Fichier:ligne | Raison |
|---|---------|----------|------------------|--------------|--------|
| 15 | POST | `/api/users/push-token` | `/api/push-token` | `push_routes.py:15` | Chemin FAUX (préfixe /users manquant) |
| 16 | DELETE | `/api/users/push-token` | `/api/push-token` | `push_routes.py:57` | Chemin FAUX (préfixe /users manquant) |

---

## DOMAINS & TAGS (12 manquants)

| # | Méthode | Path | Fichier:ligne | Raison |
|---|---------|------|--------------|--------|
| 17 | PUT | `/api/domains/{domain_id}` | `domain_routes.py:174` | Non documenté |
| 18 | GET | `/api/domains/{domain_id}/usage` | `domain_routes.py:200` | Non documenté |
| 19 | DELETE | `/api/domains/{domain_id}` | `domain_routes.py:222` | Non documenté |
| 20 | PUT | `/api/tags/categories/{category_id}` | `domain_routes.py:244` | Non documenté |
| 21 | GET | `/api/tags/categories/{category_id}/usage` | `domain_routes.py:273` | Non documenté |
| 22 | DELETE | `/api/tags/categories/{category_id}` | `domain_routes.py:297` | Non documenté |
| 23 | PUT | `/api/tags/{tag_id}` | `domain_routes.py:323` | Non documenté |
| 24 | GET | `/api/tags/{tag_id}/usage` | `domain_routes.py:343` | Non documenté |
| 25 | DELETE | `/api/tags/{tag_id}` | `domain_routes.py:359` | Non documenté |

---

## TAG POINTS (6 manquants)

| # | Méthode | Path | Fichier:ligne | Raison |
|---|---------|------|--------------|--------|
| 26 | GET | `/api/tag-points/{point_id}/similar` | `tagpoint_routes.py:554` | Non documenté |
| 27 | GET | `/api/tag-points/{point_id}/participants` | `tagpoint_routes.py:1303` | Non documenté |
| 28 | GET | `/api/users/me/pending-requests` | `tagpoint_routes.py:1325` | Non documenté |
| 29 | GET | `/api/tag-points/{point_id}/my-vote` | `tagpoint_routes.py:1703` | Non documenté |
| 30 | GET | `/api/tag-points/{point_id}/votes` | `tagpoint_routes.py:1791` | Non documenté |

---

## SPOT-YOU (1 manquant)

| # | Méthode | Path | Fichier:ligne | Raison |
|---|---------|------|--------------|--------|
| 31 | GET | `/api/spot-you/{point_id}/going` | `spot_you_routes.py:627` | Non documenté |

---

## BOOKINGS (3 manquants + 2 alias non mentionnés)

| # | Méthode | Path | Fichier:ligne | Raison |
|---|---------|------|--------------|--------|
| 32 | PATCH | `/api/bookings/{booking_id}/status` | `booking_routes.py:984` | Non documenté |
| 33 | GET | `/api/users/me/bookings` | `booking_routes.py:1036` | Alias double-décorateur non mentionné |
| 34 | GET | `/api/receiver/requests` | `booking_routes.py:1060` | Alias double-décorateur non mentionné |

---

## ADMIN (4 manquants)

| # | Méthode | Path | Fichier:ligne | Raison |
|---|---------|------|--------------|--------|
| 35 | GET | `/api/admin/tag-points` | `admin_routes.py:107` | Non documenté |
| 36 | DELETE | `/api/admin/tag-points/{point_id}` | `admin_routes.py:118` | Non documenté |
| 37 | GET | `/api/admin/services` | `admin_routes.py:127` | Non documenté |
| 38 | GET | `/api/admin/domains` | `admin_routes.py:286` | Non documenté |

---

## UPLOAD (1 manquant)

| # | Méthode | Path | Fichier:ligne | Raison |
|---|---------|------|--------------|--------|
| 39 | POST | `/api/upload-image/debug-422` | `upload_routes.py:114` | Route debug non documentée |

---

## PAYMENTS (1 manquant)

| # | Méthode | Path | Fichier:ligne | Raison |
|---|---------|------|--------------|--------|
| 40 | PATCH | `/api/payments/{payment_id}/stripe` | `payment_routes.py:410` | Non documenté |

---

## SUBSCRIPTIONS (5 manquants + 2 shadoweds non signalés)

| # | Méthode | Path | Fichier:ligne | Raison |
|---|---------|------|--------------|--------|
| 41 | GET | `/api/subscriptions/me` | `subscription_routes.py:165` | Non documenté |
| 42 | GET | `/api/subscriptions/history` | `subscription_routes.py:199` | Non documenté |
| 43 | GET | `/api/subscriptions/checkout/status/{session_id}` | `subscription_routes.py:404` | Non documenté |
| 44 | POST | `/api/admin/subscriptions/{subscription_id}/cancel` | `subscription_routes.py:472` | Non documenté |
| 45 | GET | `/api/admin/subscriptions` (subscription_routes) | `subscription_routes.py:453` | **SHADOWED** — non signalé (collision payment_routes) |
| 46 | GET | `/api/admin/subscription-plans` (subscription_routes) | `subscription_routes.py:151` | **SHADOWED** — non signalé (collision admin_routes) |

---

## ADMIN PRODUCTS (1 manquant)

| # | Méthode | Path | Fichier:ligne | Raison |
|---|---------|------|--------------|--------|
| 47 | GET | `/api/admin/products/{product_id}` | `admin_product_routes.py:84` | Non documenté |

---

## DELETION (3 manquants)

| # | Méthode | Path | Fichier:ligne | Raison |
|---|---------|------|--------------|--------|
| 48 | PATCH | `/api/users/{user_id}/deactivate` | `deletion_routes.py:522` | Non documenté |
| 49 | POST | `/api/users/{user_id}/reactivate` | `deletion_routes.py:624` | Non documenté |
| 50 | GET | `/api/users/me/reactivatable` | `deletion_routes.py:681` | Non documenté |

---

## Résumé des lacunes

| Catégorie | Absents | Chemins faux | Shadoweds non signalés |
|-----------|---------|-------------|----------------------|
| auth | 1 | 0 | 0 |
| users | 13 | 0 | 0 |
| push | 0 | 2 | 0 |
| domains/tags | 9 | 0 | 0 |
| tag-points | 5 | 0 | 0 |
| spot-you | 1 | 0 | 0 |
| bookings | 1 + 2 alias | 0 | 0 |
| admin | 4 | 0 | 0 |
| upload | 1 | 0 | 0 |
| payments | 1 | 0 | 0 |
| subscriptions | 4 | 0 | 2 |
| admin-products | 1 | 0 | 0 |
| deletion | 3 | 0 | 0 |
| **TOTAL** | **46** | **2** | **2** |
