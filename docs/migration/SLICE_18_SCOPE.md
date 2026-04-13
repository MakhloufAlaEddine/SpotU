# SLICE_18_SCOPE.md — Cadrage de la Slice 18
> Source principale : `expiry_worker.py` (251 lignes intégrales) + `server.py:274–329`.
> Tables annexes : `booking_routes.py:48–50`, `migrations/001_initial_schema.sql`.
> Généré le 2026-02-XX.

---

## Worker retenu : ExpiryWorker — expiration automatique des bookings

### Justification du choix

| Critère | Valeur |
|---|---|
| **Déblocage critique** | Sans ce worker, un booking `requested` ou `awaiting_payment` reste bloqué indéfiniment si aucune action humaine n'intervient — le slot reste verrouillé, le PaymentIntent reste ouvert chez Stripe |
| **Ferme le cycle booking/paiement** | S13 crée `awaiting_payment`, S17 crée la session Checkout — l'ExpiryWorker est le mécanisme de nettoyage si le payer ne paie pas dans le délai |
| **Lien direct Stripe** | Annule le PaymentIntent (`cancel_payment_intent`) si `authorized` ou `requires_authorization` — sans ce worker, Stripe garde une autorisation ouverte indéfiniment |
| **Multi-table atomique** | Une seule transaction : bookings + payments + service_slots + notifications — la cohérence est garantie par le pattern SKIP LOCKED |
| **Exclu du scope utilisateur** | 100% conforme aux contraintes — pas d'abonnements, pas d'admin complet, pas de WebSockets |

### Comparaison des candidats Slice 18

| Candidat | Requis pour | Complexité | Verdict |
|---|---|---|---|
| `ExpiryWorker` ✅ | Libérer slots + annuler paiements expirés | MOYEN | **Slice 18** |
| `GET /payments/me` + `GET /payments/{id}` | Lecture seule paiements | FAIBLE | Slice 19 |
| `PATCH /payments/{id}/stripe` | Usage interne uniquement | FAIBLE | Slice 19 |
| `MediaPurgeWorker` | Rétention médias 90j | FAIBLE (hors cycle booking) | Slice 20+ |
| `SpotYouNotifWorker` | Notifications SpotYou | FAIBLE (hors cycle booking) | Slice 20+ |
| Abonnements webhook | Exclu utilisateur | — | Slice 21+ |

---

## Type de composant

**Worker asyncio — tâche de fond** (aucun endpoint HTTP exposé).
Démarré au `startup` de l'application FastAPI, tourne en boucle infinie, arrêté proprement au `shutdown`.

---

## Fichiers Python sources

| Fichier | Lignes | Rôle |
|---|---|---|
| `expiry_worker.py` | 1–251 (intégral) | Logique complète du worker |
| `server.py` | 278–285, 317–320 | Démarrage / arrêt du worker |
| `stripe_service.py` | 166–186 | `cancel_payment_intent()` appelé hors transaction |
| `models.py` | 8–10 | `new_id("ntf")` — générateur d'ID pour notifications |
| `migrations/001_initial_schema.sql` | 858–863 | Index partiels sur `bookings.expires_at` |

---

## Déclenchement et fréquence

| Paramètre | Source | Valeur par défaut |
|---|---|---|
| Intervalle entre ticks | `os.environ.get("EXPIRY_WORKER_INTERVAL_SECS", "60")` | **60 secondes** |
| Taille de batch | `EXPIRY_BATCH_SIZE = 50` (hardcodé) | **50 bookings/tick** |
| Tick immédiat au démarrage | `server.py:281–285` → `worker.start()` → `_run()` appelle `_tick()` avant le premier sleep | **Oui** |
| TTL booking `requested` | `os.environ.get("BOOKING_EXPIRY_HOURS", "48")` (`booking_routes.py:49`) | **48 heures** |
| TTL booking `awaiting_payment` (pay_now) | `app_config.pay_now_checkout_minutes` (DB) | **30 minutes** (configurable admin) |
| TTL booking `awaiting_payment` (pay_later) | `services.pay_later_expiration_minutes` (DB) | **1440 min (24h)** |

> ℹ️ L'`ExpiryWorker` ne calcule pas les TTL — il se contente de lire `expires_at < NOW()`.
> Les TTL sont calculés et écrits lors de la création du booking (`booking_routes.py`) ou de l'acceptation (`/accept`).

---

## Architecture de la boucle

```
ExpiryWorker._run()
  │
  ├─ _tick() [immédiat au démarrage]
  │    └─ expire_stale_bookings(pool)
  │         └─ while True:
  │               count = _expire_batch(pool, 50)
  │               if count < 50: break   ← drain complet
  │
  └─ asyncio.sleep(60s)
       └─ _tick() [boucle infinie]
```

> ⚠️ **Patron "drain"** : Python traite TOUS les bookings expirés en plusieurs batches successifs par tick (pas seulement 50 au total). Java DOIT reproduire ce while loop — appeler une seule fois le batch serait insuffisant en cas de backlog.

---

## Dépendances

| Dépendance | Type | Conditionnel |
|---|---|---|
| Pool asyncpg | DB | Toujours |
| Table `bookings` | DB | Toujours |
| Table `payments` | DB | LEFT JOIN (peut être absent) |
| Table `service_slots` | DB | Si `slot_id IS NOT NULL` ET `slot_type IN ('single','specific')` |
| Table `notifications` | DB | Toujours (2 inserts par booking) |
| Table `services` | DB | Toujours (lecture titre pour messages) |
| `stripe_service.cancel_payment_intent()` | Stripe | Si `pi_id IS NOT NULL` ET `pay_status IN ('requires_authorization','authorized','capture_pending')` |
| `push_service` | Push | **ABSENT** — le worker n'envoie PAS de push. Uniquement des inserts DB en table `notifications` |

> ⚠️ Piège classique : il n'y a **aucun appel** `push_service.send_push_to_user()` dans `expiry_worker.py`. Les "notifications" sont des inserts en table `notifications` uniquement (pas de FCM/APNs).

---

## Niveau de risque global

**MOYEN.**

| Point de risque | Détail |
|---|---|
| `SELECT FOR UPDATE SKIP LOCKED` | JPA ne supporte pas nativement cette clause — requête native obligatoire en Java |
| Pattern "drain" (while loop multi-batch) | Risque d'oubli — Java doit boucler jusqu'à `count < BATCH_SIZE` |
| Stripe hors transaction | L'annulation Stripe est après le `COMMIT` — indispensable pour ne pas tenir le lock DB pendant un appel réseau |
| `slot_type IN ('single','specific')` | Les slots `recurring` ne sont PAS libérés — Java doit reproduire ce filtre exactement |
| Notif via DB uniquement (pas de push) | Confusion fréquente avec les autres endpoints qui font les deux |
| `new_id("ntf")` | Format `ntf_xxxxxxxxxxxx` (hex 12 chars) — Java doit générer le même format |
