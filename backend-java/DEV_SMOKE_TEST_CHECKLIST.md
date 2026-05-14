# DEV_SMOKE_TEST_CHECKLIST

Objectif: valider rapidement les flows principaux en branchant le front mobile sur le backend Java local.

Pre-check:
- [ ] Backend Java lance (`/api/liveness` OK)
- [ ] Front Expo relance avec `EXPO_PUBLIC_BACKEND_URL` vers Java
- [ ] Postgres accessible
- [ ] JWT configure (`JWT_SECRET` non vide)

## 1) Auth (login/register)

- [ ] Register utilisateur simple
- [ ] Login utilisateur existant
- [ ] `GET /api/auth/me` OK apres login
- [ ] Logout puis relogin OK

## 2) Profile

- [ ] Lecture profil (`/api/users/me`)
- [ ] Alias legacy profil (`/api/users/profile`) OK
- [ ] Update champs profil principaux
- [ ] Upload photo profil (si teste)

## 3) SpotYou

- [ ] Liste/lecture des points SpotYou
- [ ] Detail SpotYou charge
- [ ] Actions utilisateur basiques (join/leave/pending selon role)
- [ ] WS SpotYou connecte sans fermeture immediate

## 4) Services

- [ ] Liste services visible
- [ ] Detail service visible
- [ ] Creation service (si role autorise)
- [ ] Edition service (si role autorise)

## 5) Booking

- [ ] Creation booking depuis service
- [ ] Lecture booking cote buyer/seller
- [ ] Transitions statut principales (accept/refuse/cancel/complete)
- [ ] Alias legacy booking status (`PATCH /api/bookings/{id}/status`) OK

## 6) Payment sandbox (Stripe)

- [ ] Checkout session creee
- [ ] Retour status checkout coherent
- [ ] Webhook local recu si Stripe CLI actif
- [ ] Aucun etat incoherent booking/payment apres paiement

## 7) Marketplace

- [ ] Liste produits charge
- [ ] Detail produit charge
- [ ] Creation/edition produit utilisateur
- [ ] Flux moderation admin de base (si compte admin dispo)

## 8) Notifications

- [ ] Endpoint liste notifications OK
- [ ] Unread count coherent apres actions
- [ ] WS notifications connecte

## 9) Chat WS

- [ ] Ouverture conversation
- [ ] Envoi/recep message temps reel
- [ ] Reconnexion WS apres fermeture app/ecran
- [ ] Pas de boucle/duplicate message evidente

## 10) Uploads

- [ ] Upload image service/profil OK
- [ ] URL retournee charge dans app
- [ ] Fichiers locaux accessibles via `/api/uploads/**` (si mode local)

## Verdict smoke dev

- [ ] PASS: flows principaux utilisables en dev
- [ ] PARTIAL: flows critiques OK, anomalies documentees
- [ ] FAIL: blocage majeur (auth/booking/payment/chat)

Zone "notes anomalies":
- ...

