# ASYNC_AND_SIDE_EFFECTS.md

Tout ce qui sort du **simple handler HTTP synchrone** (au sens logique métier) : workers, boucles, notifications, fichiers, webhooks.

---

## 1. Démarrage / arrêt application (`server.py`) — **certain**

### 1.1 Startup (`@app.on_event("startup")`)

| Composant | Classe / module | Effet |
|-----------|-----------------|-------|
| DB pool | `connect_to_db()` | Connexion PostgreSQL asyncpg. |
| `ExpiryWorker` | `expiry_worker.py` | Boucle asyncio : expiration réservations (intervalle `EXPIRY_WORKER_INTERVAL_SECS`, TTL `BOOKING_EXPIRY_HOURS`). |
| `SpotYouNotifWorker` | `spot_you_notif_worker.py` | Notifications SpotYou (détail **non lu**). |
| `AdminProductReminderWorker` | `admin_product_reminder_worker.py` | Rappels admin produits. |
| `MediaPurgeWorker` | `media_purge_worker.py` | Purge médias (rétention). |
| `MediaNotifWorker` | `media_notif_worker.py` | Pré-notification purge. |

**Stockage sur `app.state`** : références aux workers pour `shutdown`.

### 1.2 Shutdown (`@app.on_event("shutdown")`)

- Arrêt ordonné de chaque worker (`await ...stop()`).
- `close_db()` — fermeture pool.

---

## 2. Workers / scripts CLI — **certain** (fichiers présents)

| Fichier | Mode d’exécution | Effet (d’après en-tête / nom) |
|---------|------------------|-------------------------------|
| `admin_purge_worker.py` | CLI `python3 admin_purge_worker.py …` **et** appel depuis API admin (`run_purge`) | Traitement batch `pending_file_deletions` ; R2 ou filesystem. |
| `seed.py` | Manuel | Données de démo — **non analysé**. |

---

## 3. Webhooks & tâches indirectes — **certain**

| Entrée | Fichier | Effet |
|--------|---------|-------|
| `POST /api/webhook/stripe` | `payment_routes.py` → `webhook_handlers.dispatch` | Mise à jour DB paiements, réservations, abonnements ; notifications ; idempotence. |

**Effet de bord** : appels Stripe API (annulation subscription, etc.) depuis handlers subscription / admin.

---

## 4. Notifications push — **certain**

| Fonction / contexte | Fichier | Effet |
|---------------------|---------|-------|
| `send_push_notification` | `push_service.py` | Appel **Expo Push API** (`PushClient().publish`) sauf `TEST_ENV=test`. |
| `store_notification` (nom typique) | `push_service.py` (suite fichier **non lue**) | Insert DB + possible WS — **flou détail**. |

**Déclencheurs** : nombreux handlers + `webhook_handlers` + `chat_routes` helpers (`_push_unread` mentionné dans grep).

---

## 5. WebSockets — **certain**

| Endpoint | Handler | Effet |
|----------|---------|-------|
| `/api/ws/chat/{conv_id}` | `ws_chat` | Temps réel chat ; état partagé via `chat_manager` (**détail flou**). |
| `/api/ws/notifications` | `ws_notifications` | Flux notifications. |
| `/api/ws/spot-you/{point_id}` | `ws_spot_you` | Activité SpotYou temps réel. |

**Risque** : connexions longues, authentification sur socket, reconnexion — **à auditer** avant migration.

---

## 6. Fichiers & stockage — **certain**

| Action | Fichiers | Effet |
|--------|----------|-------|
| Upload image | `upload_routes.py` | Compression Pillow (mention doc), écriture R2 ou disque. |
| StaticFiles | `server.py` | Sert fichiers sous `/api/uploads` depuis `ROOT_DIR/uploads`. |
| Suppression | `upload_routes.py` `delete_upload_file` | R2 ou fichier local avec garde path traversal. |
| Planification suppression | `deletion_routes.py` helpers | Entrées `pending_file_deletions` (**déduit**). |

**Incohérence potentielle** : `upload_routes.py` utilise `Path("/app/backend/uploads")` alors que `server.py` monte `ROOT_DIR / "uploads"` — **deux racines possibles** (voir risques).

---

## 7. Paiements côté API (hors webhook) — **moyen**

- `create_checkout_session`, `pay_booking`, `accept_booking` : interactions Stripe via `stripe_service` — **séquence exacte non reconstituée** dans cet audit.

---

## 8. Incertitudes

- Fréquence exacte et requêtes SQL **internes** à chaque worker (hors en-têtes).
- File d’attente / broker **externe** : **aucun** Redis/RabbitMQ détecté dans les imports parcourus — traitement **in-process** (déduit).
