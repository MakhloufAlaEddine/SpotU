# SLICE_36_SCOPE.md — Cadrage de la Slice 36 (Audit Booking Reads)
> Basé sur `routes/booking_routes.py:1035–1110, 69–77`, `docs/migration/SLICE_11_*.md`.
> Généré le 2026-04-25.

---

## ⚠️ Constat majeur : Slice 11 couvre DÉJÀ ces endpoints

L'audit du code Python `booking_routes.py:1035–1110` confirme que **les 3 endpoints booking read sont strictement identiques** à ce que documente la **Slice 11** (datée 2026-02-XX) :

| Endpoint | Slice 11 | Code Python actuel | Divergence |
|---|---|---|---|
| `GET /bookings/me` (alias `/users/me/bookings`) | doc lignes 1035–1056 | lignes 1035–1056 | **AUCUNE** |
| `GET /bookings/received` (alias `/receiver/requests`) | doc lignes 1059–1077 | lignes 1059–1077 | **AUCUNE** |
| `GET /bookings/{booking_id}` | doc lignes 1080–1110 | lignes 1080–1110 | **AUCUNE** |
| `BOOKING_FIELDS` (22 colonnes) | doc lignes 69–77 | lignes 69–77 | **AUCUNE** (même liste) |
| `_deserialize(pricing_snapshot)` | doc lignes 80–87 | lignes 80–87 | **AUCUNE** |

→ **Conclusion** : aucun nouveau code à porter en Java pour les **booking reads**.

---

## Objet réel de la Slice 36 — AUDIT + RÉGRESSION + DELTA

S36 ne **redocumente pas** S11. Elle :

1. **Confirme** que la spec S11 est toujours valide pour le cutover front
2. **Vérifie l'intégration** des slices migrées depuis S11 (S30, S31, S34, S35) avec les booking reads — chacune ayant pu **enrichir** la projection ou changer la valeur de champs visibles
3. **Identifie les vrais gaps** front-impact restants et **recommande** la prochaine slice utile

| # | Méthode | Chemin API | Statut S36 |
|---|---|---|---|
| 1 | GET | `/api/bookings/me` (+ alias `/api/users/me/bookings`) | **Couvert S11 — pas de re-port** |
| 2 | GET | `/api/bookings/received` (+ alias `/api/receiver/requests`) | **Couvert S11 — pas de re-port** |
| 3 | GET | `/api/bookings/{booking_id}` | **Couvert S11 — pas de re-port** |

> ⚠️ Si Cursor a déjà implémenté S11 côté Java : **passer directement à la régression**. Sinon : implémenter S11 d'abord, puis appliquer les vérifs S36.

---

## Fichiers Python relus (delta vs S11)

| Fichier | Lignes | Différence vs S11 |
|---|---|---|
| `routes/booking_routes.py` | 1035–1110 | **Identique** |
| `routes/booking_routes.py` | 69–77 (BOOKING_FIELDS) | **Identique** |
| `routes/booking_routes.py` | 80–87 (`_deserialize`) | **Identique** |
| `auth_utils.py` | 71–83 (`require_auth`) | **Identique** (déjà documenté en S34 BR-34.01) |
| `database.py` | 53–69 (`row_to_dict`) | **Identique** |

---

## Endpoints booking write encore non migrés (HORS S36)

| Méthode | Chemin | Lignes | Slice future suggérée |
|---|---|---|---|
| POST | `/bookings/price-preview` | 115–384 | S37 (preview) |
| POST | `/bookings/request` (alias `/bookings`) | 385–400 + 391 | S38 (création — gros) |
| POST | `/bookings/{id}/accept` | 401–557 | S39 (Stripe payment intent) |
| POST | `/bookings/{id}/pay` | 558–674 | déjà partiellement couvert par S30 |
| POST | `/bookings/{id}/refuse` | 675–753 | S40 (petit) |
| POST/DELETE | `/bookings/{id}/cancel` | 754–983 | S41 (cancel + refunds + notif push) |
| PATCH | `/bookings/{id}/status` | 984–1034 | S42 (admin override) |

> Ces endpoints sont **explicitement exclus** de S36 (et de S11). Ce sont des écritures complexes (Stripe, slots concurrents, notifications push, workers).

---

## Niveau de risque S36

**TRÈS FAIBLE.** S36 ne porte aucun nouveau code. Elle vérifie uniquement :
- Que les contrats S11 restent respectés en Java
- Que les valeurs de champs `payment_status`, `status`, et le **nouveau** `refund_amount`/`refund_status` (introduits en S35) sont correctement remontés via les booking reads

| Point | Risque | Action |
|---|---|---|
| **Champ `refund_amount`/`refund_status` non visible via booking reads** | FAIBLE | Vérification : ces champs sont sur `payments`, pas `bookings`. Booking reads ne les exposent **pas** directement. Compat stricte = ne rien ajouter. **Front doit appeler `/payments/{id}` (S34) pour voir les refunds.** |
| **`bookings.payment_status='paid'` après webhook S33** | FAIBLE | S33 set `bookings.payment_status='paid'`. S11 le retourne via BOOKING_FIELDS. Régression : valider que ce champ est bien à jour côté Java après webhook. |
| **`bookings.status='confirmed'` après S33** | FAIBLE | Idem. Valider. |
| **Ordre de tri `created_at DESC`** | FAIBLE | Doit être préservé (S11 le documente). |
| **Permissions `/{id}` 4-OR (`user_id, payer_user_id, receiver_user_id, coach_id`)** | MOYEN | Asymétrie vs S34 (`/payments/{id}` est 3-OR). **Vérification critique** : 4 champs côté booking, 3 côté payment. À ne pas confondre lors de la migration Java. |
| **Aliases dual routing** | FAIBLE | `/users/me/bookings` et `/receiver/requests` doivent être exposés (S11 le documente). |

---

## Résumé ultra court

- **Endpoints choisis (3, déjà couverts par S11)** :
  1. `GET /api/bookings/me` (alias `/api/users/me/bookings`)
  2. `GET /api/bookings/received` (alias `/api/receiver/requests`)
  3. `GET /api/bookings/{booking_id}`

- **Déjà couvert vs manquant** :
  - **Déjà couvert intégralement par Slice 11** (datée 2026-02-XX) : 3 endpoints, BOOKING_FIELDS 22 colonnes, JOINs services/users/service_slots, permissions, ordre, aliases.
  - **Aucune divergence** entre S11 et le code Python actuel (vérifié à la ligne près).
  - **Manquant côté write** : `POST /bookings/request`, `POST /bookings/{id}/cancel`, `POST /bookings/{id}/refuse`, etc. → **slices ultérieures S37+**.

- **Tables touchées (lecture seule)** :
  - **READ** : `bookings`, `services` (LEFT JOIN), `users` (LEFT JOIN x2), `service_slots` (LEFT JOIN)
  - Pas d'écriture.

- **Top 3 pièges** :
  1. **Permissions 4-OR sur `/{id}`** : `user_id, payer_user_id, receiver_user_id, coach_id` (4 champs, pas 3 comme S34 payments). **Vérifier** que Cursor n'a pas oublié `coach_id` ni `user_id` lors du port Java.
  2. **Aliases dual routing** : `/users/me/bookings` et `/receiver/requests` doivent être exposés en plus des chemins principaux. Spring : 2 `@GetMapping` sur la même méthode handler.
  3. **`pricing_snapshot` désérialisation conditionnelle** (idem `pricing_rule_snapshot` S34) : parse JSON si string, laisse tel quel si dict. **Easy à oublier** ; déjà documenté S11 mais à revérifier post-S33/S35.

- **Raison du choix** : S36 est essentiellement une slice d'**audit + régression** — elle confirme que S11 reste valide après que S30→S35 ont été migrées, et identifie les écarts réels restants pour le cutover front. **Rien de neuf à coder côté reads booking.** La VRAIE prochaine slice utile au front (= booking writes : `POST /bookings/request` + `POST /bookings/{id}/cancel`) doit être adressée en S37+ car elle est **bien plus grosse** (Stripe payment intent, slot locks, workers, notifications). S36 n'invente rien : elle valide, ferme le sujet booking-reads, et oriente vers le bon prochain effort.
