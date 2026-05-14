# Slice 04 — Profil public d’un autre utilisateur

## Endpoint

- **Source Python** : `GET /api/users/{user_id}/public` (`user_routes.py:99-235`)
- **Implémentation Java** : `GET /api/users/{userId}/public`

## Ce qui a été implémenté

- `PublicProfileController` pour l’endpoint public.
- `PublicProfileService` avec logique métier Python :
  - auth **optionnelle** (`me_id = null` si token absent/invalide/expiré/user introuvable)
  - `404 {"detail":"User not found"}` si cible inexistante
  - masquage `phone` quand `show_phone = false`
  - reviews conditionnelles (`show_reviews`)
  - `is_following` seulement si appelant authentifié et différent de la cible
  - `services` présent uniquement pour les coachs (absent sinon)
  - enrichissement `tag_points` : `participants_count`, `going_count`, `rating`, `vote_count`, `next_session_date`, `is_full`
- `NextSessionDateCalculator` aligné sur `spot_you_routes.py` :
  - fuseau `Europe/Paris`
  - convention weekday Python 0=lundi … 6=dimanche
  - priorité `event_schedule` sur `event_date`
- `PublicProfileRepository` avec accès SQL lecture seule sur les tables requises.

## Tests ajoutés

- `PublicProfileIntegrationTest` :
  - nominal coach (sans token)
  - token invalide => HTTP 200 + `is_following=false`
  - token valide follower => `is_following=true`
  - non-coach : téléphone masqué + clé `services` absente
  - user inexistant => 404 detail

## Notes / écarts

- Aucun renommage de chemin métier : le Java garde le même chemin fonctionnel que Python.
- Les erreurs DB restent mappées en 503 par le handler global Java (écart déjà documenté).
