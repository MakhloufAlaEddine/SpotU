# ASYNC_AND_SIDE_EFFECTS.md — Workers, async, effets secondaires SpotU
> Généré le 2026-04-11.

---

## 1. Workers asyncio (lancés au startup, stoppés au shutdown)

### ExpiryWorker (`expiry_worker.py`)
| Champ | Valeur |
|-------|--------|
| Intervalle | 60s (configurable `EXPIRY_WORKER_INTERVAL_SECS`) |
| Déclenché par | Boucle asyncio automatique |
| Batch size | 50 bookings max par tick |
| Verrou DB | `SELECT … FOR UPDATE SKIP LOCKED` (multi-worker safe) |
| Atomicité | Transaction unique par booking expiré |

**Transitions déclenchées :**
- `bookings.status` : `requested` | `awaiting_payment` → `expired`
- `service_slots.status` : `pending` | `reserved` → `available`
- `payments.status` : `requires_authorization` | `authorized` | `capture_pending` → `cancelled`
- Notifications push : payer + receiver
- Annulation PaymentIntent Stripe si status était `authorized`

---

### SpotYouNotifWorker (`spot_you_notif_worker.py`)
| Champ | Valeur |
|-------|--------|
| Intervalle | 900s (15 min) |
| Fenêtre post-séance | 20 min après la fin |
| Fenêtre pré-séance | entre 2h45 et 3h15 avant début |

**Notifications envoyées :**
1. Après fin de séance : notif à tous les membres NON participants → "Réserve ta place"
2. 3h avant séance (si capacité non atteinte) : notif aux membres non inscrits
**Anti-doublon :** vérifie `notifications` table — pas de doublon si même type+point+session_date

---

### AdminProductReminderWorker (`admin_product_reminder_worker.py`)
| Champ | Valeur |
|-------|--------|
| Intervalle | 600s (10 min) |
| Délai déclenchement | 2h après `created_at` en `pending_review` |

**Actions :**
- UPDATE `marketplace_products.admin_reminder_sent_at = NOW()`
- Push vers TOUS les admins : "Produit en attente de validation"
- Max 50 produits par tick

---

### MediaPurgeWorker (`media_purge_worker.py`)
| Champ | Valeur |
|-------|--------|
| Intervalle | 3600s (1h) |
| Condition déclenchement | `media_purge_scheduled_at <= NOW()` AND `media_purged=false` AND `reactivated_at` < `deleted_at` |

**Actions :**
- Parcourt : `tag_points`, `services`, `marketplace_products`, `users`
- Marque `media_purged=true`, `media_purged_at=NOW()`
- Appelle `admin_purge_worker.run_purge(pool, retention_days=0)` → suppression physique R2
- Utilise `ON CONFLICT DO NOTHING` pour `pending_file_deletions`
- **Idempotent** : skip si `reactivated_at IS NOT NULL AND reactivated_at >= deleted_at`

---

### MediaNotifWorker (`media_notif_worker.py`)
| Champ | Valeur |
|-------|--------|
| Intervalle | 900s (15 min) |
| Fenêtre | `media_purge_scheduled_at BETWEEN NOW() AND NOW()+7j` |

**Actions :**
- Marque `media_purge_notified_at=NOW()`
- Push aux propriétaires : "Tes médias seront supprimés dans 7 jours"
- **Idempotent** : skip si `media_purge_notified_at IS NOT NULL`

---

## 2. Tâches asynchrones inline (dans les routes)

### Envoi push en background
Toutes les routes critiques délèguent l'envoi de push via `asyncio.create_task(send_push_to_user(...))`.
Ne bloque pas la réponse HTTP. Pas de retry si échec (fire-and-forget).
**Fichiers concernés :** `booking_routes.py`, `tagpoint_routes.py`, `product_creation_routes.py`, `admin_product_routes.py`, `webhook_handlers.py`

### Suppression de fichiers R2 en background
`deletion_routes.py:_schedule_file_deletions()` insère dans `pending_file_deletions` (pas de suppression immédiate).
La purge réelle est différée et traitée par `admin_purge_worker.run_purge()` / `MediaPurgeWorker`.

---

## 3. Notifications (push + in-app)

### Flux de création d'une notification
1. `store_notification(conn, user_id, type, title, body, data)` → INSERT dans `notifications`
2. `notify_user(user_id, payload)` via `NotificationManager` → WebSocket push si connecté
3. `send_push_to_user(pool, user_id, title, body, data)` → Expo Push API (si token disponible)

### Types de notifications recensés (non exhaustif)
| Type | Déclencheur |
|------|------------|
| `booking_requested` | Nouvelle demande de booking |
| `booking_accepted` | Booking accepté par receiver |
| `booking_refused` | Booking refusé |
| `booking_cancelled` | Annulation |
| `booking_expired` | Expiration worker |
| `payment_captured` | Paiement capturé (webhook Stripe) |
| `payment_failed` | Échec paiement (webhook Stripe) |
| `payment_refunded` | Remboursement (webhook Stripe) |
| `subscription_activated` | Abonnement activé |
| `subscription_cancelling` | Abonnement en cours d'annulation |
| `subscription_cancelled` | Abonnement annulé |
| `join_request` | Demande d'adhésion à un SpotYou |
| `join_accepted` | Demande acceptée |
| `join_rejected` | Demande refusée |
| `product_approved` | Produit validé par admin |
| `product_rejected` | Produit rejeté |
| `admin_product_reminder` | Rappel produit pending > 2h |
| `media_purge_warning` | Purge médias dans 7j |
| `spotyou_pre_session` | 3h avant séance |
| `spotyou_post_session` | Après séance |

---

## 4. WebSocket (temps réel)

| Canal | Route | Auth |
|-------|-------|------|
| Chat | `/ws/chat/{conv_id}` | JWT query param `?token=` |
| Notifications globales | `/ws/notifications` | JWT query param `?token=` |
| Activité SpotYou | `/ws/spot-you/{point_id}` | JWT query param `?token=` |

**Note migration Spring :** Ces canaux WS sont gérés nativement par FastAPI. En Spring Boot, utiliser `@EnableWebSocketMessageBroker` avec STOMP ou WebSocket natif (`@ServerEndpoint`). L'auth via query param devra être adaptée (Spring Security WebSocket).

---

## 5. Paiements (Stripe) — effets déclenchés

### Lors de l'acceptation d'un booking (`accept_booking`)
1. Vérification que `payment_intent_id` existe et que le montant correspond
2. Appel Stripe `capture_payment_intent()` → `status=capture_pending`
3. Le webhook `payment_intent.succeeded` confirme → `status=captured`

### Lors de l'annulation d'un booking (`cancel_booking`)
Logique conditionnelle selon le statut :
- `requested` → annule sans Stripe
- `awaiting_payment` → annule PaymentIntent Stripe
- `confirmed` → remboursement Stripe (selon délai)

### Webhook Stripe (`/api/webhook/stripe`)
Processus d'idempotence :
1. Déchiffrement signature Stripe (HMAC)
2. INSERT `stripe_webhook_events` — si conflit sur PK → skip
3. Dispatch vers handler approprié
4. UPDATE `status='processed'` dans `stripe_webhook_events`

---

## 6. Uploads / Fichiers

### Upload (route `/api/upload-image`)
1. Validation type MIME (JPEG, PNG, WEBP, GIF, HEIC)
2. Compression PIL (max 2000px, JPEG quality 85)
3. Upload R2 via boto3 (`upload_fileobj`)
4. Retourne URL publique `R2_PUBLIC_URL/{key}`

### Suppression (différée)
1. Lors d'un delete d'entité → INSERT `pending_file_deletions` (status=pending)
2. `admin_purge_worker.run_purge()` → SELECT pending, DELETE R2, UPDATE status=done
3. Erreurs → status=failed (pas de retry automatique)

---

## 7. Suppressions différées (soft delete → purge physique)

| Entité | Déclencheur | J+0 | J+83 | J+90 |
|--------|-------------|-----|------|------|
| tag_points | DELETE endpoint | `deleted_at=NOW()` | Notif push owner | Purge médias R2 |
| services | DELETE endpoint | `deleted_at=NOW()` | Notif push owner | Purge médias R2 |
| marketplace_products | DELETE endpoint | `deleted_at=NOW()` | Notif push owner | Purge médias R2 |
| users | DELETE endpoint | `deleted_at=NOW()` + anonymisation | Notif push user | Purge médias R2 |

---

## 8. Triggers implicites

| Événement | Effet secondaire |
|-----------|-----------------|
| Création SpotYou | Owner auto-inscrit comme membre `accepted` (migration 016) |
| Rejoindre SpotYou (pending) | Notif aux admins (et membres si `members_approval`) |
| Accepter invitation SpotYou | UPDATE spot_you_members status=accepted, notif invité |
| Quitter SpotYou | DELETE future `spot_you_attendance` |
| Création produit marketplace | Notif admins si `pending_review` |
| Expiration booking | Libération du slot Stripe + notifs |
| Réactivation entité | Annule `media_purge_scheduled_at` si `reactivated_at >= deleted_at` |
