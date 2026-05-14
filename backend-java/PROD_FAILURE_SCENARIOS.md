# PROD_FAILURE_SCENARIOS

Date: 2026-05-08

## Scenario 1 - Webhook Stripe accepte des events non verifies

- Cause: `STRIPE_WEBHOOK_SECRET` absent/mal injecte.
- Impact user: statuts payment/booking incoherents, notifications erronees.
- Detection: hausse events webhook invalides, mismatch Stripe dashboard vs DB.
- Rollback: rerouter webhook vers Python immediatement + geler handlers Java.

## Scenario 2 - Chat/Notif en cluster: messages "perdus"

- Cause: WS registry local process, pods multiples sans bus pub/sub.
- Impact user: unread/message non synchronises selon pod.
- Detection: ecart unread totals, plaintes "je ne recois pas les messages".
- Rollback: forcer sticky sessions ou reroute WS vers Python temps reel.

## Scenario 3 - Images cassent apres cutover

- Cause: fallback local actif mais `/api/uploads/**` non servi.
- Impact user: avatars/photos produits/services invisibles.
- Detection: hausse 404 media, erreurs rendering front.
- Rollback: basculer upload/media vers Python ou activer R2-only + URL publiques.

## Scenario 4 - Push mobile silencieux

- Cause: services push no-op sur flux critiques.
- Impact user: engagement en baisse, messages/notifications rates.
- Detection: ecart DB notifications vs telemetry Expo delivery.
- Rollback: rerouter push vers Python ou desactiver promesse produit "temps reel push".

## Scenario 5 - Regression front sur parsing erreurs

- Cause: heterogeneite `detail/error/details` + 400/422/500/503.
- Impact user: ecrans bloques sur handling erreurs strict.
- Detection: crash front/apis "unexpected response shape".
- Rollback: normalisation au gateway, ou reroute endpoints fragiles.

## Scenario 6 - Deadlocks/contention sur operations concurrentes

- Cause: lock SQL (`NOWAIT`, workers, updates concurrents bookings/payments).
- Impact user: hausse 409/503, actions intermittentes.
- Detection: logs lock timeout/deadlock, augmentation retry.
- Rollback: reduire trafic Java sur flux concernes, fallback Python domain-by-domain.

## Scenario 7 - PostGIS drift prod

- Cause: extension absente, schema different, plan SQL degrade.
- Impact user: feed geospatial vide/lent.
- Detection: latence georequetes + baisse resultats.
- Rollback: rerouter home/services/spotyou reads vers Python.

## Scenario 8 - Split-routing rollback incomplet

- Cause: routage partiel non atomique entre domains dependants (bookings/payments/webhooks).
- Impact user: etats incoherents, idempotence brisee.
- Detection: records orphelins, statuts divergents.
- Rollback: policy rollback "bounded context complet", jamais endpoint isole critique.

## Scenario 9 - Async side-effects perdus

- Cause: @Async + erreurs non bloquantes + restart node.
- Impact user: notif manquantes sans erreur visible API.
- Detection: mismatch actions vs notifications creees.
- Rollback: repasser side-effects critiques en synchrone temporairement.

## Scenario 10 - Exposition WS origines trop permissive

- Cause: `setAllowedOriginPatterns("*")`.
- Impact user: risque securite/session abuse.
- Detection: connexions WS anormales.
- Rollback: restreindre origins immediatement au niveau proxy/app.
