# BLOCKERS_BEFORE_FRONT_SWITCH.md — Blockers réels avant cutover
> Généré le 2026-04-30. Source : `FINAL_CUTOVER_GAPS.md` + `FRONT_API_COVERAGE.md`.

---

## Convention

- **P0** = écran 100% inopérant ou flow critique cassé. Cutover impossible.
- **P1** = fonctionnalité dégradée mais app utilisable. Cutover risqué.
- **P2** = correctifs / dette technique. Cutover possible avec dette assumée.

---

## 🔴 P0 — BLOCKERS ABSOLUS (cutover impossible sans)

### B-P0-01 — Domaine **Chat** entièrement non migré
- **Endpoints manquants** : 6 REST (`POST/GET /conversations*`, `messages`, `read`, `leave`) + 1 WebSocket (`/api/ws/spot-you/...`)
- **Impact front** : écran Chat (tab principal) 100% KO. Boutons "Contacter" depuis profil/SpotYou KO.
- **Charge estimée** : 1 grosse slice (S42 ou équivalent) — 4–6 jours de doc + impl Java incluant WebSocket Spring (`@MessageMapping` + STOMP ou SockJS).
- **Décision requise** : rester sur Python pendant le cutover (proxy Chat sur Python) ou migrer avant cutover ?

### B-P0-02 — Domaine **Services coach** entièrement non migré
- **Endpoints manquants** : 11 (`service_routes.py` — search, mine, saved, deactivated, detail, create, update, delete, reactivate, save, unsave)
- **Impact front** : les coachs ne peuvent pas publier de services en Java → conséquence en cascade : **les bookings S11–S15 ne peuvent rien réserver** (pas de services à booker côté Java DB lectures).
- **Charge estimée** : 2 slices (CRUD + lifecycle/saved) — 3–5 jours total.
- **Décision requise** : impératif avant cutover OU dual-routing booking (Java book → Python service lookup, complexe).

### B-P0-03 — **Slice 12 (booking create) à confirmer**
- **Constat** : la PRD ne mentionne pas explicitement Slice 12. Les slices 11+13–18 couvrent reads + writes lifecycle, mais le **`POST /bookings/request`** (création) n'apparaît dans aucun titre de slice.
- **Impact front** : si non migré, **AUCUNE nouvelle réservation** n'est possible côté Java. Le flow complet (booking → checkout → webhook → expiry) tombe à l'eau.
- **Action immédiate** : auditer `/app/docs/migration/SLICE_12_*.md` ; si absent, créer la doc avant cutover.

### B-P0-04 — **Notifications inbox** non migré
- **Endpoints manquants** : 3 (`GET /users/me/notifications`, `PATCH .../read`, `PATCH .../read-all`)
- **Impact front** : badge notif KO, écran "Mes notifications" KO. Les push reçus ne s'historisent pas côté UI.
- **Charge estimée** : 1 slice — 1.5 jours.

### B-P0-05 — **Agenda / Planning events** non migré
- **Endpoints manquants** : 2 (`GET /users/me/events`, `GET /users/me/planning-events`)
- **Impact front** : tab Agenda KO. Les SpotYou rejoints + bookings acceptés n'apparaissent pas dans l'agenda.
- **Charge estimée** : 1 slice (jointure tag_points + bookings + service_slots) — 1–2 jours.

### B-P0-06 — **SpotYou RSVP "Going"** non migré
- **Endpoints manquants** : 4 (`POST/DELETE /spot-you/{id}/going`, `GET /going`, `GET /spot-you/my-completion-stats`)
- **Impact front** : `my-completion-stats` est appelé directement par le front (grep confirmé). Compteur "j'y vais" + stats utilisateur KO.
- **Charge estimée** : 0.5–1 slice — 1 jour.

### B-P0-07 — **Search utilisateurs** non migré
- **Endpoint manquant** : `GET /users/search?q=`
- **Impact front** : barre de recherche utilisateurs KO (mention détectée par grep).
- **Charge estimée** : 0.25 slice — 0.5 jour.

### B-P0-08 — **JWT_SECRET shared** non vérifié
- **Risque** : si `JWT_SECRET` Java ≠ Python, **tous les tokens existants invalidés au cutover**. Tous les utilisateurs reçoivent 401 d'un coup et doivent se reconnecter.
- **Action immédiate** : confirmer que la valeur de `JWT_SECRET` (env var) est strictement identique entre les 2 pods.

### B-P0-09 — **Stripe webhook signature** sur Spring
- **Risque** : Spring 6 parse le body JSON par défaut, ce qui **invalide la signature HMAC** Stripe. Tous les events webhook seraient rejetés (mais Stripe retry → boucle infinie côté infra).
- **Action immédiate** : configurer le controller webhook avec `@RequestBody byte[]` (raw bytes) et `@RequestHeader("Stripe-Signature")`. Vérifier en preprod avec `stripe trigger`.

### B-P0-10 — **Backend Java DOIT démarrer**
- **Constat actuel** : le backend Python est en panne dans cet environnement (Supabase tenant ENOTFOUND). Si ce problème persiste sur le pod Java, cutover impossible.
- **Action** : valider l'accès Supabase production-ready depuis le pod Java avant tout switch.

---

## 🟡 P1 — IMPORTANTS (cutover dégradé mais utilisable)

### B-P1-01 — **Adresses** non migré
- 4 endpoints (`GET/POST/PUT/DELETE /addresses*`)
- Impact : carnet d'adresses (livraison/déplacement) KO. Le seller marketplace ne peut pas sélectionner d'adresse de retrait.
- Charge : 0.5 slice — 0.5–1 jour.

### B-P1-02 — **Graph social** (follow/block/reviews) non migré
- ~13 endpoints (`user_routes.py:494-667+`).
- Impact : profil utilisateur tiers dégradé (pas de stats followers, pas de bouton follow, pas d'avis). UX dégradée mais non bloquante.
- Charge : 1.5 slices — 2–3 jours.

### B-P1-03 — **Lifecycle compte utilisateur (RGPD)** non migré
- 4 endpoints (`deletion_routes.py` — DELETE/deactivate/reactivate/reactivatable)
- Impact : impossible de supprimer son compte ou de le réactiver côté Java. **RGPD compliance** = risque légal si pas de mécanisme de suppression. **Critique en zone EU.**
- Charge : 1 slice — 1.5 jours.

### B-P1-04 — **Votes SpotYou** non migré
- 3 endpoints (`vote`, `votes`, `my-vote`)
- Impact : feature votes communautaires SpotYou KO.
- Charge : 0.5 slice — 1 jour.

### B-P1-05 — **Invitations SpotYou inbox** partiellement migré
- À confirmer : S27 couvre invite mais accept/refuse en endpoints distincts (`tagpoint_routes.py:1007/1059`) + `GET /users/me/spotyou-invitations` non migré.
- Impact : si non migré → utilisateur ne peut pas accepter/refuser une invitation reçue.
- Charge : 0.25 slice — 0.5 jour.

### B-P1-06 — **Domaines/tags admin CRUD** non migré
- ~10 endpoints `domain_routes.py` writes (POST/PUT/DELETE domaines/categories/tags + usage)
- Impact : admin ne peut plus gérer le référentiel depuis Java. Lectures publiques OK (S10).
- Charge : 1 slice — 1–1.5 jour.

### B-P1-07 — **Admin général** (stats, app-config, payments, pricing-rules, users management, purge) non migré
- ~12 endpoints `admin_routes.py`
- Impact : tableau de bord admin dégradé. Operations critiques (verify-coach, change role) KO en Java.
- Charge : 1 slice — 1.5–2 jours.

### B-P1-08 — **Activity feed user** non migré
- 1 endpoint (`GET /users/me/activity-feed`)
- Charge : 0.25 slice — 0.5 jour.

### B-P1-09 — **MediaPurgeWorker physique R2** STUB
- S40 a documenté le scheduler en STUB ; la purge physique des fichiers R2 n'est pas implémentée.
- Impact : coût stockage R2 dérive (fichiers supprimés DB mais conservés sur R2). **Pas bloquant cutover** (background job, peut être livré post-cutover).
- Charge : S40-bis — 1.5 jours.

---

## 🟢 P2 — MINEURS (dette technique, cutover OK)

### B-P2-01 — Duplications Python `GET /admin/subscription-plans`
- Même path dans `admin_routes.py:210` ET `subscription_routes.py:151` côté Python avec shapes différents.
- Java a tranché côté S22 — vérifier que le front consomme bien le shape S22 et non l'autre.

### B-P2-02 — Duplications Python `GET /admin/subscriptions`
- Idem `admin_routes.py:497` ET `subscription_routes.py:453`.

### B-P2-03 — Anomalies compat préservées (S40+S41)
- Zombie status (admin approve un produit deleted → ressuscité)
- `rejection_reason = admin_comment` dupliqué (reject)
- Reactivate force `status='active'` (perte historique)
- `cover_image_url` non purgée si hors `image_urls[]`
- `data.admin_comment = ""` vs DB null (push payload)

→ Documentées comme dette ; quality slice post-cutover.

### B-P2-04 — `admin_purge_worker.run_purge` en STUB (S40-bis)
- Cf. B-P1-09. Décalable post-cutover si tolérance dette stockage.

### B-P2-05 — Endpoints Python potentiellement non utilisés
- `POST /upload-image/debug-422`
- `GET /auth/native-callback` (Expo OAuth uniquement)
- `GET /admin/purge` + `purge/status`
- À auditer pour drop éventuel.

### B-P2-06 — Achat produit marketplace
- N'existe PAS en Python (audit confirmé).
- Pas un gap migration mais à concevoir post-cutover.

---

## Synthèse

| Priorité | Compte | Charge totale estimée |
|---|---|---|
| 🔴 P0 | 10 | **~12–18 jours** (incluant Chat WebSocket lourd) |
| 🟡 P1 | 9 | ~10–14 jours |
| 🟢 P2 | 6 | ~3 jours (si traités) |

**Charge totale avant cutover P0+P1** : **~22–32 jours** (~4–6 semaines à 1 dev temps plein, ~2–3 semaines à 2 devs).

---

## GO / NO-GO Cutover

### ❌ NO-GO actuel (bloquants P0)

Cutover **impossible** tant que :
1. Chat n'est pas migré (B-P0-01) — sauf si proxy Python conservé pour ce domaine
2. Services coach ne sont pas migrés (B-P0-02) — sinon bookings inopérants
3. Slice 12 (booking create) confirmée OU créée (B-P0-03)
4. Notifications + Agenda migrés (B-P0-04, B-P0-05)
5. JWT_SECRET partagé vérifié (B-P0-08)
6. Stripe webhook bytes raw vérifié (B-P0-09)

### ✅ Conditions GO (minimales)

Cutover **possible** si :
- Tous les P0 levés ou contournés (proxy hybride)
- P1 Adresses + RGPD acceptés en dégradé OU contournés
- Tests E2E preprod sur les 8 flows critiques :
  1. Inscription / login (Auth)
  2. Création SpotYou + RSVP (SpotYou + going)
  3. Création service coach + réservation (Services + Bookings)
  4. Paiement Stripe + webhook (Payments)
  5. Souscription premium (Subscriptions)
  6. Publication produit + validation admin (Marketplace)
  7. Conversation 1-1 + lecture (Chat)
  8. Notifications inbox + read-all (Notifications)
- Monitoring + rollback préparés (cf. `TECHNICAL_HARDENING_CHECKLIST.md`)
