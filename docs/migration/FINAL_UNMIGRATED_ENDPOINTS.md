# FINAL_UNMIGRATED_ENDPOINTS.md — Liste canonique des endpoints non migrés
> Généré le 2026-04-13.

---

## Légende statuts

| Statut | Signification |
|---|---|
| ❌ NON MIGRÉ | Aucune documentation Slice |
| ⚠️ PARTIEL | Domaine documenté partiellement (reads OK, writes manquants) |

## Légende priorités

| Priorité | Signification |
|---|---|
| P0 | Bloquant — le front ne peut pas fonctionner sans |
| P1 | Important — fonctionnalité dégradée sans |
| P2 | Secondaire — contournable temporairement |
| P3 | Admin / background — pas d'impact front direct |

---

## 1. Auth — `auth_routes.py` (prefix `/auth`)

| # | Méthode | Chemin | Statut | Priorité | Notes |
|---|---|---|---|---|---|
| 1 | POST | /auth/register | ❌ | P0 | Hash bcrypt, JWT, INSERT users |
| 2 | POST | /auth/login | ❌ | P0 | Vérif bcrypt, JWT, cookie |
| 3 | POST | /auth/google | ❌ | P0 | Google OAuth, upsert user |
| 4 | POST | /auth/logout | ❌ | P1 | Supprime push token |
| 5 | PUT | /auth/change-password | ❌ | P1 | Vérifie ancien, hash nouveau |
| 6 | GET | /auth/native-callback | ❌ | P2 | Deep link Expo OAuth |

---

## 2. User — `user_routes.py` (prefix `/users`)

| # | Méthode | Chemin | Statut | Priorité | Notes |
|---|---|---|---|---|---|
| 7 | PUT | /users/profile | ❌ | P0 | Update nom, bio, phone, picture, show_* |
| 8 | POST | /users/become-coach | ❌ | P0 | Bascule role user→coach |
| 9 | PATCH | /users/{uid}/cover | ❌ | P1 | Update cover image |
| 10 | GET | /users/me/activity-feed | ❌ | P1 | Feed activité perso |
| 11 | GET | /users/{uid}/suggestions | ❌ | P1 | Suggestions follow |
| 12 | GET | /users/search | ❌ | P0 | Recherche utilisateurs |
| 13 | POST | /users/{uid}/reviews | ❌ | P1 | Créer avis post-booking |
| 14 | PUT | /users/{uid}/reviews/{rid} | ❌ | P2 | Modifier avis |
| 15 | DELETE | /users/{uid}/followers/{fid} | ❌ | P2 | Retirer un follower |

---

## 3. Bookings — `booking_routes.py`

| # | Méthode | Chemin | Statut | Priorité | Notes |
|---|---|---|---|---|---|
| 16 | POST | /bookings/request (+ alias /bookings) | ⚠️ | P0 | Création réservation — le plus gros endpoint (220 lignes) |
| 17 | POST | /bookings/{id}/pay | ⚠️ | P0 | Initie paiement Stripe (checkout) |
| 18 | POST | /bookings/price-preview | ⚠️ | P1 | Aperçu pricing engine |

---

## 4. Payments — `payment_routes.py`

| # | Méthode | Chemin | Statut | Priorité | Notes |
|---|---|---|---|---|---|
| 19 | GET | /payments/me | ❌ | P1 | Liste paiements de l'utilisateur |
| 20 | GET | /payments/{payment_id} | ❌ | P1 | Détail paiement |
| 21 | PATCH | /payments/{pid}/stripe | ❌ | P3 | Update champs Stripe (interne) |
| 22 | GET | /admin/payments | ❌ | P3 | Admin list payments |
| 23 | GET | /admin/payments/stats | ❌ | P3 | Admin dashboard stats |

---

## 5. Services — `service_routes.py`

| # | Méthode | Chemin | Statut | Priorité | Notes |
|---|---|---|---|---|---|
| 24 | POST | /services | ⚠️ | P0 | Créer service (coach) |
| 25 | PUT | /services/{id} | ⚠️ | P0 | Modifier service |
| 26 | PATCH | /services/{id} | ⚠️ | P1 | Alias PUT |
| 27 | DELETE | /services/{id} | ⚠️ | P0 | Soft-delete service |
| 28 | GET | /services/mine | ⚠️ | P0 | Mes services (coach) |
| 29 | GET | /services/saved | ⚠️ | P1 | Services sauvegardés |
| 30 | GET | /services/deactivated | ⚠️ | P1 | Services désactivés |
| 31 | POST | /services/{id}/reactivate | ⚠️ | P1 | Réactiver service |
| 32 | POST | /services/{id}/save | ⚠️ | P1 | Sauvegarder service |
| 33 | DELETE | /services/{id}/unsave | ⚠️ | P1 | Retirer sauvegarde |

---

## 6. SpotYou / TagPoints — `tagpoint_routes.py` + `spot_you_routes.py`

| # | Méthode | Chemin | Statut | Priorité | Notes |
|---|---|---|---|---|---|
| 34 | GET | /tag-points | ❌ | P0 | Liste (PostGIS, filtres) |
| 35 | GET | /tag-points/mine | ❌ | P0 | Mes SpotYou |
| 36 | GET | /tag-points/saved | ❌ | P0 | Sauvegardés |
| 37 | GET | /tag-points/{id} | ❌ | P0 | Détail (complexe — 15+ sous-requêtes) |
| 38 | GET | /tag-points/{id}/similar | ❌ | P1 | Similaires (PostGIS) |
| 39 | POST | /tag-points | ❌ | P0 | Créer SpotYou |
| 40 | PUT | /tag-points/{id} | ❌ | P0 | Modifier SpotYou |
| 41 | PATCH | /tag-points/{id}/new-date | ❌ | P1 | Changer date |
| 42 | POST | /tag-points/{id}/save | ❌ | P0 | Sauvegarder |
| 43 | DELETE | /tag-points/{id}/unsave | ❌ | P0 | Retirer sauvegarde |
| 44 | POST | /tag-points/{id}/join | ❌ | P0 | Rejoindre |
| 45 | DELETE | /tag-points/{id}/cancel-request | ❌ | P0 | Annuler demande |
| 46 | POST | /tag-points/{id}/invite | ❌ | P0 | Inviter membre |
| 47 | GET | /users/me/spotyou-invitations | ❌ | P0 | Mes invitations |
| 48 | POST | /tag-points/{id}/invitations/accept | ❌ | P0 | Accepter invitation |
| 49 | POST | /tag-points/{id}/invitations/refuse | ❌ | P0 | Refuser invitation |
| 50 | GET | /tag-points/{id}/join-requests | ❌ | P0 | Demandes adhésion |
| 51 | POST | /tag-points/{id}/members/{mid}/approve | ❌ | P0 | Approuver |
| 52 | POST | /tag-points/{id}/members/{mid}/reject | ❌ | P0 | Rejeter |
| 53 | DELETE | /tag-points/{id}/leave | ❌ | P0 | Quitter |
| 54 | GET | /tag-points/{id}/participants | ❌ | P0 | Liste participants |
| 55 | GET | /users/me/pending-requests | ❌ | P0 | Mes demandes en attente |
| 56 | GET | /tag-points/{id}/my-vote | ❌ | P1 | Mon vote |
| 57 | POST | /tag-points/{id}/vote | ❌ | P1 | Voter |
| 58 | GET | /tag-points/{id}/votes | ❌ | P1 | Liste votes |
| 59 | POST | /spot-you/{id}/join | ❌ | P0 | Rejoindre (v2) |
| 60 | DELETE | /spot-you/{id}/leave | ❌ | P0 | Quitter (v2) |
| 61 | POST | /spot-you/{id}/going | ❌ | P0 | Participer |
| 62 | DELETE | /spot-you/{id}/going | ❌ | P0 | Annuler participation |
| 63 | GET | /spot-you/my-completion-stats | ❌ | P1 | Stats perso |
| 64 | GET | /spot-you/{id}/activity | ❌ | P1 | Activité |
| 65 | GET | /spot-you/{id}/going | ❌ | P1 | Liste participants going |

---

## 7. Chat — `chat_routes.py`

| # | Méthode | Chemin | Statut | Priorité | Notes |
|---|---|---|---|---|---|
| 66 | POST | /conversations | ❌ | P0 | Créer conversation |
| 67 | GET | /conversations | ❌ | P0 | Liste conversations |
| 68 | GET | /conversations/{id}/messages | ❌ | P0 | Messages |
| 69 | PUT | /conversations/{id}/read | ❌ | P0 | Marquer lu |
| 70 | WS | /ws/chat/{conv_id} | ❌ | P0 | Chat temps réel |
| 71 | WS | /ws/notifications | ❌ | P0 | Notifications temps réel |
| 72 | WS | /ws/spot-you/{point_id} | ❌ | P1 | SpotYou temps réel |

---

## 8. Home — `home_routes.py`

| # | Méthode | Chemin | Statut | Priorité | Notes |
|---|---|---|---|---|---|
| 73 | GET | /home/feed | ❌ | P0 | Feed accueil |
| 74 | GET | /home/nearest-sector | ❌ | P0 | Secteur géo proche |

---

## 9–14. Domaines restants (résumé)

| Domaine | # endpoints | Priorité max | Fichier |
|---|---|---|---|
| Notifications (3) | 75–77 | P0 | tagpoint_routes.py |
| Planning (2) | 78–79 | P0 | tagpoint_routes.py |
| Upload (2) | 80–81 | P0 | upload_routes.py |
| Push tokens (2) | 82–83 | P0 | push_routes.py |
| Deletion/Rétention (8) | 84–91 | P1 | deletion_routes.py |
| Products/Marketplace (6) | 92–97 | P1 | product_creation_routes.py, marketplace_routes.py |
| Addresses (4) | 98–101 | P2 | address_routes.py |
| Admin products (4) | 102–105 | P3 | admin_product_routes.py |
| Admin global (~15) | 106–120 | P3 | admin_routes.py |
| Référentiels CRUD admin (12) | 121–132 | P3 | domain_routes.py |

---

## Comptage final

| Priorité | Endpoints | Cumul |
|---|---|---|
| P0 | ~64 | 64 |
| P1 | ~32 | 96 |
| P2 | ~8 | 104 |
| P3 | ~36 | 140 |
| **TOTAL NON MIGRÉ** | **~140** | |
