# BUSINESS_RULES_EXTRACT.md — Règles métier SpotU
> Légende confiance : ✅ Élevée (code explicite) | ⚠️ Moyenne (déduit du code) | ❓ Faible (implicite/ambigu)

---

## MODULE : AUTH / UTILISATEURS

### R1 — Rôles utilisateurs
✅ **Confiance : Élevée**
Trois rôles : `user` | `coach` | `admin`. Stocké dans `users.role`.
- Seul un admin peut upgrader un rôle via `PUT /admin/users/{id}/role`
- Un `user` peut devenir `coach` lui-même via `POST /users/become-coach` (sans validation admin)
- Un `coach` peut être vérifié par un admin (`is_coach_verified=true`)
**Source :** `auth_utils.py:require_role`, `user_routes.py:become_coach`, `admin_routes.py:set_user_role`

### R2 — JWT stateless, pas de blacklist serveur
✅ **Confiance : Élevée**
Le logout est purement côté client. Un token valide permet l'accès jusqu'à son expiration (7 jours), même après logout.
**Source :** `auth_routes.py:logout`

### R3 — Mots de passe : bcrypt uniquement
✅ **Confiance : Élevée**
`password_hash` peut être NULL (users Google OAuth). Les utilisateurs OAuth ne peuvent pas utiliser change-password.
**Source :** `auth_utils.py:hash_password, verify_password`

---

## MODULE : SPOTYOU (TAG POINTS)

### R4 — Visibilité géographique obfusquée
✅ **Confiance : Élevée**
La localisation retournée aux non-propriétaires est bruitée selon le champ `precision` :
- `exact` → coordonnées réelles
- `100m` → décalage gaussien ≤ 100m
- `1000m` → décalage gaussien ≤ 1000m
**Source :** `tagpoint_routes.py:apply_precision_offset, build_point_response`

### R5 — SpotYou privé : accès invitation uniquement
✅ **Confiance : Élevée**
- `visibility_type='private'` → `POST /join` retourne 403
- Seule voie d'entrée : invitation via `POST /invite` + `POST /invitations/accept`
- Un SpotYou privé est visible publiquement (dans les listes), mais inaccessible sans invitation
**Source :** `tagpoint_routes.py:join_tag_point` (l.735), `spot_you_routes.py`

### R6 — Modes d'adhésion
✅ **Confiance : Élevée**
- `join_mode='open'` + public → membre `accepted` immédiatement
- `join_mode='admin_approval'` → statut `pending`, notifications aux admins seulement
- `join_mode='members_approval'` → statut `pending`, notifications aux admins + membres
**Source :** `tagpoint_routes.py:join_tag_point`

### R7 — Permissions d'invitation
✅ **Confiance : Élevée**
- `invite_permissions='admin_only'` → seul l'owner peut inviter
- `invite_permissions='members_only'` → seuls les membres acceptés peuvent inviter
- `invite_permissions='admin_and_members'` → owner + membres acceptés
**Source :** `tagpoint_routes.py:invite_user_to_spotyou`

### R8 — Capacité max communauté
✅ **Confiance : Élevée**
`max_community_members` NULL = illimité. Si défini, le join est bloqué (400) si le nombre d'`accepted` ≥ max.
**Source :** `tagpoint_routes.py:join_tag_point`

### R9 — Double requête interdite
✅ **Confiance : Élevée**
Un utilisateur déjà `accepted` ou `pending` ne peut pas soumettre une nouvelle demande.
Un utilisateur `rejected` PEUT re-soumettre (ON CONFLICT DO UPDATE WHERE status='rejected').
Un utilisateur `invited` retourne un message spécifique sans modifier son statut.
**Source :** `tagpoint_routes.py:join_tag_point`

### R10 — Quitter une communauté annule les participations futures
⚠️ **Confiance : Moyenne** (code présent mais logique difficile à tracer complètement)
Quitter (`leave`) supprime les `spot_you_attendance` futures (session_date ≥ today).
**Source :** `tagpoint_routes.py:leave_tag_point` (DELETE spot_you_attendance WHERE session_date >= NOW())

### R11 — Concurrence sur accept/reject
✅ **Confiance : Élevée**
Un second admin qui essaie d'accepter/refuser une demande déjà traitée reçoit HTTP 409.
**Source :** `tagpoint_routes.py:approve_join_request, reject_join_request`

### R12 — L'owner est systématiquement inscrit comme membre accepted
✅ **Confiance : Élevée**
À la création d'un SpotYou, l'owner est automatiquement inséré dans `spot_you_members` avec status='accepted'.
**Source :** `tagpoint_routes.py:create_tag_point` + migration 016

### R13 — Vote SpotYou : un vote par user
⚠️ **Confiance : Moyenne**
Un utilisateur peut voter une seule fois (ON CONFLICT DO UPDATE → mise à jour du vote existant).
**Source :** `tagpoint_routes.py:vote_tag_point`

---

## MODULE : BOOKINGS

### R14 — Workflow booking (machine à états)
✅ **Confiance : Élevée**
```
requested
  ├─ (receiver accept) → awaiting_payment (si pay_now)
  │                    → confirmed (si pay_later ou Stripe direct)
  ├─ (expire TTL)      → expired
  └─ (receiver refuse) → refused

awaiting_payment
  ├─ (stripe captured) → confirmed
  └─ (expire TTL)      → expired

confirmed
  └─ (annulation)      → cancelled
```
**Source :** `booking_routes.py:_do_booking_request, accept_booking, pay_booking`, `expiry_worker.py`

### R15 — TTL paiement configurable
✅ **Confiance : Élevée**
`BOOKING_EXPIRY_HOURS` (défaut 48h). `expires_at = NOW() + TTL` au moment de la demande.
Un worker tourne toutes les 60s et expire les bookings dépassés.
**Source :** `expiry_worker.py`, `booking_routes.py:_do_booking_request`

### R16 — Idempotence booking
✅ **Confiance : Élevée**
Chaque demande de booking porte un `idempotency_key`. Une seconde requête avec la même clé retourne 409.
**Source :** `booking_routes.py:_do_booking_request`

### R17 — Mode paiement
✅ **Confiance : Élevée**
- `pay_now` : paiement Stripe requis dans le délai TTL
- `pay_later` : confirmation sans paiement immédiat (configurable admin via `enable_pay_later_for_services`)
**Source :** `booking_routes.py`, `admin_routes.py:get_app_config`

### R18 — Slot : atomic reservation
✅ **Confiance : Élevée**
Le slot passe `available → pending` lors de la demande. `pending → available` si le booking expire/est refusé. `pending → booked` si confirmé.
**Source :** `booking_routes.py:_do_booking_request, accept_booking, refuse_booking`

---

## MODULE : PRICING ENGINE

### R19 — Frais calculés par règle active
✅ **Confiance : Élevée**
`pricing_engine.compute_pricing()` :
1. Récupère la règle active la plus prioritaire pour le `product_type`
2. Vérifie les exemptions d'abonnement actif de l'utilisateur
3. Calcule `payer_total = base + payer_fixed_fee + (base × payer_percent_fee/100)`
4. Calcule `receiver_net = base - receiver_fixed_fee - (base × receiver_percent_fee/100)`
**Source :** `pricing_engine.py`

### R20 — Snapshot de prix immuable
✅ **Confiance : Élevée**
Le résultat du calcul est stocké en JSONB dans `payments.pricing_rule_snapshot` et `bookings.pricing_snapshot` et n'est JAMAIS recalculé après création.
**Source :** `booking_routes.py:_do_booking_request`

---

## MODULE : PAIEMENTS STRIPE

### R21 — Double capture impossible
✅ **Confiance : Élevée**
Les webhooks Stripe vérifient `rows_updated > 0` avant d'émettre une notification. Un event_id déjà présent dans `stripe_webhook_events` est skip silencieusement.
**Source :** `webhook_handlers.py`

### R22 — Source de vérité : webhook
✅ **Confiance : Élevée**
Les statuts `payments.status` et `user_subscriptions.status` sont TOUJOURS mis à jour via les webhooks Stripe, jamais déduits de la logique applicative (sauf exception documentée : `accept_booking` pre-capture + webhook idempotent).
**Source :** `webhook_handlers.py` (commentaire introductif)

### R23 — Refund : partiel ou total
✅ **Confiance : Élevée**
Géré via `charge.refunded` webhook. Si `amount_refunded = amount` → `refunded`. Sinon → `partially_refunded`.
**Source :** `webhook_handlers.py:_handle_charge_event`

---

## MODULE : ABONNEMENTS

### R24 — Abonnement actif → exemption de frais
✅ **Confiance : Élevée**
Un abonnement actif (`user_subscriptions.status='active'`) peut exempter l'utilisateur de certains frais (payer_fixed, payer_percent, receiver_fixed, receiver_percent) selon les flags du plan.
**Source :** `pricing_engine.py`, `subscription_plans` colonnes `exempt_*`

### R25 — Snapshot bénéfices abonnement
✅ **Confiance : Élevée**
Au moment de la souscription, un snapshot des bénéfices (`benefits_snapshot`) est stocké dans `user_subscriptions`. Résiste aux modifications ultérieures du plan.
**Source :** `subscription_routes.py:subscribe, _build_benefits_snapshot`

---

## MODULE : SOFT DELETE / RÉTENTION MÉDIAS

### R26 — Rétention médias 90 jours
✅ **Confiance : Élevée**
À la suppression : `media_purge_scheduled_at = deleted_at + 90j`.
À J+83 : notification push envoyée (MediaNotifWorker).
À J+90 : purge physique des fichiers R2 (MediaPurgeWorker).
Si réactivé avant J+90 : purge annulée (`reactivated_at` < `media_purge_scheduled_at`).
**Source :** `deletion_routes.py`, `media_purge_worker.py`, `media_notif_worker.py`

### R27 — Anonymisation à la suppression
⚠️ **Confiance : Moyenne**
À la suppression d'un user, les données personnelles identifiables sont anonymisées (email, phone, iban…). `anonymized_at` est marqué.
**Source :** `deletion_routes.py:delete_user`

---

## MODULE : PRODUITS MARKETPLACE

### R28 — Validation admin obligatoire
✅ **Confiance : Élevée**
Tout nouveau produit passe par `status='pending_review'`. Un admin doit l'approuver pour le rendre `active`.
**Source :** `product_creation_routes.py:create_product`, `admin_product_routes.py`

### R29 — Rappel admin si produit non traité 2h+
✅ **Confiance : Élevée**
Si un produit est en `pending_review` depuis > 2h sans traitement, tous les admins reçoivent un push. Le rappel est répété toutes les 2h.
**Source :** `admin_product_reminder_worker.py`

---

## MODULE : MODÉRATION SOCIALE

### R30 — Blocage : contenu masqué mutuellement
⚠️ **Confiance : Moyenne**
Quand A bloque B, B ne devrait plus voir le contenu de A dans les feeds. La logique de filtrage est partiellement visible dans certaines requêtes SQL mais non systématique dans tous les endpoints.
**Source :** `user_routes.py:block_user`, requêtes search partiellement filtrées

### R31 — Soft delete message : contenu masqué, message existant
✅ **Confiance : Élevée**
Un message supprimé garde `deleted_at != NULL`. Le contenu est rendu vide côté API (à vérifier dans chat_routes.py).
**Source :** `deletion_routes.py:delete_message`

---

## MODULE : NOTIFICATIONS

### R32 — Notification SpotYou pré/post séance
⚠️ **Confiance : Moyenne**
- 3h avant la prochaine séance (capacité non atteinte) : notif aux membres non inscrits
- Après la fin d'une séance : notif à tous les membres non-participants pour "réserver la prochaine"
- Anti-doublon : vérification qu'une notif du même type pour ce point + date n'a pas déjà été envoyée
**Source :** `spot_you_notif_worker.py`

### R33 — Notifications in-app stockées ET push
✅ **Confiance : Élevée**
Toutes les notifications sont stockées dans la table `notifications` (persistantes) ET envoyées en push Expo si le token est disponible.
**Source :** `push_service.py:send_push_to_user` (appels dans presque tous les modules)

---

## INCERTITUDES / AMBIGUÏTÉS À VALIDER AVANT MIGRATION

| # | Ambiguïté | Module | Action recommandée |
|---|-----------|--------|-------------------|
| A1 | Le blocage filtre-t-il vraiment tous les endpoints (search, home feed, activity) ? | Social | Audit manuel de chaque requête SQL |
| A2 | `services.booking_approval_mode` vs `app_config.enable_manual_approval` : lequel prime ? | Booking | Lire `_normalize_booking_config()` en détail |
| A3 | `tag_points.schedule` (TEXT) vs `event_schedule` (JSONB) : l'un est-il encore utilisé ? | SpotYou | Vérifier si schedule TEXT est encore lu dans le code |
| A4 | Le `stripe_customer_id` est-il toujours créé avant une subscription ? Que se passe-t-il s'il est NULL ? | Paiements | Tracer le flow `subscribe()` |
| A5 | `user_subscriptions` : peut-il y avoir plusieurs abonnements actifs en simultané ? | Abonnements | Vérifier la requête dans `get_my_subscription` |
| A6 | La liste `user_roles` (JSONB) dans `users` est-elle utilisée en plus de `role` TEXT ? | Auth | Vérifier les usages dans le code |
