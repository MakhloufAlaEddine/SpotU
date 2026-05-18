# MIGRATION_RISKS.md

---

## 1. Risques **élevés**

| Risque | Détail | Source |
|--------|--------|--------|
| **Webhook Stripe** | Logique centralisée volumineuse, idempotence, effets sur 3 agrégats (payments, bookings, subscriptions), notifications. | `webhook_handlers.py` |
| **JWT & auth** | Secret obligatoire au import ; cookie `winek_token` + Bearer ; OAuth Emergent. | `auth_utils.py`, `auth_routes.py` |
| **Double route `GET /api/admin/subscriptions`** | Déclarée dans `payment_routes.py` et `subscription_routes.py` — comportement FastAPI / ordre d’inclusion = **comportement effectif à vérifier en runtime**. | `server.py` ordre include ; grep |
| **Workers in-process** | Comportement différent sous plusieurs replicas K8s (double exécution) sauf leader election externe. | `server.py` startup |
| **WebSockets** | État mémoire `chat_manager` — scalabilité horizontale **incertaine** sans sticky sessions / bus. | `chat_routes.py` |

---

## 2. Risques **moyens**

| Risque | Détail |
|--------|--------|
| **Chemins uploads** | `server.py` sert `ROOT_DIR/uploads` ; `upload_routes.py` utilise `/app/backend/uploads` — fichiers potentiellement **hors sync**. |
| **SQL brut dispersé** | Peu ou pas d’ORM : migration Java = réécrire requêtes ou introduire couche mapping ; risque de régression. |
| **Rate limiting slowapi** | Basé sur IP + headers proxy — à reproduire (Bucket4j, API Gateway, etc.). |
| **PostGIS** | Requêtes géo dans `home_routes`, `service_routes`, etc. — équivalent Java (Hibernate Spatial, jOOQ, SQL natif). |
| **Enums texte SQL vs Pydantic** | Divergence legacy possible. |
| **Tests existants** | Couverture large mais hétérogène ; dépendance à URLs externes dans certains tests. |

---

## 3. Logique **dispersée** (couplage)

- **Réservation** : `booking_routes` + `payment_routes` + `webhook_handlers` + `expiry_worker` + config `app_config`.
- **SpotYou** : `tagpoint_routes` + `spot_you_routes` + WS + `spot_you_notif_worker`.
- **Produits marketplace** : `product_creation_routes` + `admin_product_routes` + `marketplace_routes` + Stripe + notifications admin.

---

## 4. Effets de bord **cachés** (à traquer)

- Triggers SQL : **non inventoriés** dans cet audit (grep triggers non effectué) → **flou**.
- `handle_subscription_event` appelé depuis webhook, pas route HTTP directe.
- `delete_upload_file` appelé depuis plusieurs flux (suppression compte, purge, etc.) — **recherche `delete_upload` usages recommandée**.

---

## 5. Dépendances fortes

- **Aucun bus d’événements** détecté : tout est synchrone HTTP + workers asyncio + Stripe push.
- **Stripe** comme vérité financière : toute migration doit **garder** les mêmes `metadata` / `customer` IDs ou prévoir **migration de données Stripe** (très coûteux).

---

## 6. Code mort / maintenance

- `get_spot_you_members` sans route : risque de **documentation erronée** côté front si quelqu’un suppose un endpoint.
- `COMMISSION_RATE` : risque de **double définition** avec `pricing_rules` en base.
