# SLICE_34_SCOPE.md — Cadrage de la Slice 34
> Basé sur `routes/payment_routes.py:32–80`, `auth_utils.py:71–83`, `database.py:53–69`.
> Généré le 2026-04-25.

---

## Flow choisi — Payment Reads (`GET /payments/me` + `GET /payments/{id}`) — 2 endpoints

| # | Méthode | Chemin API | Auth | Complexité | Fichier : Lignes |
|---|---|---|---|---|---|
| 1 | GET | `/api/payments/me` | JWT (`require_auth`) | FAIBLE | `payment_routes.py` : 41–59 |
| 2 | GET | `/api/payments/{payment_id}` | JWT (`require_auth`) + permissions | FAIBLE-MOYEN | `payment_routes.py` : 62–80 |

### Périmètre fonctionnel exact

**`GET /payments/me`** — Liste des paiements de l'utilisateur :
1. Auth JWT obligatoire
2. SELECT paiements WHERE `payer_user_id = uid` OR `receiver_user_id = uid`
3. JOIN `users` (LEFT) pour récupérer `payer_name` et `receiver_name`
4. ORDER BY `created_at DESC`
5. Désérialise `pricing_rule_snapshot` (string JSON → object) si nécessaire
6. Retourne **liste** de payments (peut être vide).

**`GET /payments/{payment_id}`** — Détail d'un paiement :
1. Auth JWT obligatoire
2. SELECT par `payment_id`
3. 404 si introuvable
4. **Filtre permissions** : 403 sauf si user.user_id == payer OR user.user_id == receiver OR user.role == 'admin'
5. Désérialise `pricing_rule_snapshot`
6. Retourne **objet** payment.

### Ce qui est explicitement HORS périmètre Slice 34
- `POST /payments/checkout/session` (lignes 85–193) → déjà couvert par S30 (booking pay)
- `GET /payments/checkout/status/{session_id}` (lignes 195–351) → déjà couvert par S31
- `POST /webhook/stripe` (356–405) + handlers (S32, S33)
- `PATCH /payments/{payment_id}/stripe` (410–450) → écriture admin ; futur slice
- `GET /admin/payments` + `/admin/payments/stats` + `/admin/subscriptions` (452–511) → slice admin séparée
- `_handle_charge_event` (refunds) → S35
- `_handle_subscription_event` → S36

> Justification du split : S34 ne contient **que des lectures user-scope**. Les endpoints admin et les écritures sont des slices distinctes pour préserver le périmètre permissions clair.

---

## Pourquoi cette slice — Justification du choix

| Critère | Justification |
|---|---|
| **Petit bloc utile au front** | 2 endpoints, ~40 lignes Python, **READ-only**. Pas de Stripe SDK, pas de Stripe webhook, pas de transitions DB. Cible exacte de la demande utilisateur. |
| **Ferme le parcours buyer côté lecture** | Après S30 (créer + payer), S31 (status post-redirect), S32–S33 (webhook), il manque **la consultation**. Sans S34, le front ne peut pas afficher l'écran "Mes paiements" ni "Détail paiement". **Blocker pour le cutover front complet.** |
| **Indépendant des refunds/abonnements** | Aucune dépendance à S35 (refunds) ni S36 (subscriptions). Migrable en parallèle si besoin. |
| **Pattern réutilisable** | Auth JWT + filtrage `payer_user_id OR receiver_user_id` + permissions (owner/admin) = pattern qui sera **réutilisé** pour `bookings/me`, `bookings/{id}`, etc. (slices futures). Bien le valider ici. |
| **Risque métier minimal** | Lecture pure. Pas de transition. Au pire : retour vide ou 403/404. Pas de désync DB possible. |
| **Mini-slice véritablement testable** | ~6 cas de test critiques (nominal liste, nominal détail, auth manquante, payment introuvable, accès interdit, liste vide). Tous unitaires testcontainers. |
| **Pas de dépendance frontend bloquante** | Le front peut consommer immédiatement ces routes via `REACT_APP_BACKEND_URL` sans changement d'auth ou de routing. |

### Alternatives écartées

| Alternative | Pourquoi non |
|---|---|
| **Refunds/charge events (`_CHARGE_EVENTS` + `_handle_charge_event`)** | C'est encore du webhook (suite de S33). Pas "directement utile au front" — l'utilisateur final voit juste le statut updated. Les ~150 lignes du handler complexifient sans débloquer une UI. **À reporter en S35**. |
| **Chat / WebSocket complet** | 700+ lignes, pattern stateful, gestion connexion + messages + push. Casse la règle "petit bloc". Slice dédiée plus tard. |
| **`PATCH /payments/{id}/stripe`** | Endpoint d'override admin. Utilité front nulle (admin only, rarement utilisé). |
| **`GET /admin/payments` + stats** | Domaine admin séparé. Doit être groupé avec d'autres endpoints admin (slice "admin reads") pour cohérence. |
| **Bundle reads + writes payments (`/me`, `/{id}`, `PATCH /{id}/stripe`)** | Mélange permissions user + admin. La PATCH admin nécessite `require_role('admin')` + des règles d'audit différentes. |
| **Bundle `/payments/me` seul (sans `/{id}`)** | Le front affiche typiquement liste → click → détail. Migrer la liste sans le détail crée un trou UX. |

---

## Fichiers Python analysés

| Fichier | Lignes | Rôle |
|---|---|---|
| `routes/payment_routes.py` | 32–36 | `_deserialize` helper (parse `pricing_rule_snapshot` JSON string → dict) |
| `routes/payment_routes.py` | 41–59 | `GET /payments/me` (liste) |
| `routes/payment_routes.py` | 62–80 | `GET /payments/{payment_id}` (détail + permissions) |
| `auth_utils.py` | 71–83 | `require_auth` (JWT extract + DB lookup user) |
| `auth_utils.py` | 61–65 | `get_token_from_request` (Bearer header OU cookie `winek_token`) |
| `auth_utils.py` | 68 | `USER_FIELDS` (colonnes users sélectionnées par require_auth) |
| `database.py` | 53–65 | `row_to_dict` (asyncpg Record → dict JSON-safe : Decimal→float, datetime→isoformat) |
| `database.py` | 68–69 | `rows_to_list` |

---

## Dépendances

| Dépendance | Type | Obligatoire | Commentaire |
|---|---|---|---|
| Auth JWT (Slice X auth) | Sécurité | OUI | `require_auth` doit retourner un user dict avec `user_id` et `role` |
| Cookie `winek_token` | Auth | OPTIONNEL | Fallback si pas de Bearer header |
| Table `payments` | DB SELECT | OUI | Schéma défini en S30 |
| Table `users` | DB SELECT (JOIN) | OUI | Pour `name` payer/receiver dans `/me` |
| `pricing_rule_snapshot` colonne JSONB ou TEXT | DB | OUI | Si TEXT contenant JSON → désérialisé applicativement ; si JSONB → décodé par asyncpg automatiquement |

---

## Niveau de risque

**FAIBLE-MOYEN.**

| Point | Risque | Impact Java |
|---|---|---|
| **Permissions `/payments/{id}`** | MOYEN | 3 conditions OR : `payer_user_id == uid` OR `receiver_user_id == uid` OR `role == 'admin'`. Si l'une est mal portée → leak de données entre users. **Test critique.** |
| **Auth JWT — Bearer OU cookie** | MOYEN | Java doit lire le header `Authorization: Bearer ...` ET le cookie `winek_token`. Spring : `WebMvcConfigurer` ou filtre custom. Si seul Bearer porté → casse le mode cookie web. |
| **Désérialisation `pricing_rule_snapshot`** | MOYEN | Si la colonne est TEXT en DB et contient un JSON string, asyncpg ne décode pas → Python parse manuellement. Java/JPA : selon le type de colonne JPA (`String` vs `JsonNode` vs `Map`), la sérialisation diffère. **Vérifier le type de colonne réel avant migration.** |
| **`SELECT *` retour** | MOYEN | Le code Python fait `SELECT p.*`. Toutes les colonnes de `payments` sont retournées (incl. internes comme `stripe_secret`, `metadata`, `idempotency_key`). Java doit reproduire **exactement** la liste de colonnes pour ne pas exposer ou cacher de champ. |
| **Sérialisation `Decimal` → `float`** | FAIBLE | `row_to_dict` convertit Decimal en float. Java/Jackson : configurer `BigDecimal` → `number` (pas string). Sinon précision peut différer. |
| **`datetime.isoformat()`** | FAIBLE | Format ISO 8601 avec offset (ex: `2026-04-25T11:37:13.540123+00:00`). Java : `OffsetDateTime.toString()` produit le même format. ✅ |
| **Liste vide vs 404** | FAIBLE | `/payments/me` retourne `[]` (pas 404) si aucun paiement. Java doit retourner `[]`, **pas** un objet wrapper `{data: []}` ni 404. |
| **Ordre `created_at DESC`** | FAIBLE | Doit être préservé (le front affiche du plus récent au plus ancien). |
| **JOIN `LEFT JOIN users`** | FAIBLE | Si user supprimé → name null. Reproduire le LEFT JOIN (pas INNER). |

---

## Résumé ultra court

- **Flow choisi (2 endpoints)** :
  1. `GET /api/payments/me` — liste des paiements payer OR receiver, ordre `created_at DESC`, JOIN names
  2. `GET /api/payments/{payment_id}` — détail avec permissions `payer || receiver || admin`

- **Tables touchées** :
  - **READ uniquement** : `payments` (SELECT *), `users` (LEFT JOIN pour name)
  - **PAS d'écriture** — slice 100% lecture

- **Top 3 pièges** :
  1. **Permissions 3-conditions OR** sur `/payments/{id}` : `payer == uid` OR `receiver == uid` OR `role == 'admin'`. Si porté avec AND ou conditions inversées → leak ou faux 403. **Test exhaustif obligatoire** sur les 4 cas (payer / receiver / admin / autre user).
  2. **Auth dual : Bearer header OU cookie `winek_token`**. Java doit gérer **les deux**. Le front mobile envoie Bearer ; le front web peut s'appuyer sur cookie HttpOnly. Casser un des deux casse une plateforme.
  3. **`SELECT *`** : retourner **toutes** les colonnes de `payments` exactement comme Python (asyncpg → dict). Si Java/JPA sélectionne uniquement les champs DTO → champs manquants dans la réponse → casse le front. Utiliser `nativeQuery` ou DTO miroir complet incluant `stripe_*`, `metadata`, `pricing_rule_snapshot`, etc.

- **Raison du choix** : C'est le **plus petit bloc directement utile au front** parmi les candidats. Lecture pure (zero risque métier), 2 endpoints, ~40 lignes Python. Débloque les écrans "Mes paiements" + "Détail paiement" du buyer **côté Java**, fermant le parcours buyer end-to-end (créer S30 → payer S30 → status S31 → webhook S32-33 → **consulter S34**). Refunds restent isolés en S35, chat/WS reste un gros chantier séparé. Pattern auth+permissions ici est **réutilisable** pour les slices reads suivantes (bookings/me, services/me, etc.).
