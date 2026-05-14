# FRONT_COMPATIBILITY_GAPS

Date: 2026-05-08  
Objectif: ecarts concrets front <-> backend-java a corriger ou shim avant cutover.

## P0 - Bloquants potentiels

1. **Serving uploads local absent**
- Backend genere des URLs `/api/uploads/{file}` en fallback local.
- Route de serving statique `/api/uploads/**` non exposee.
- Impact: images cassees si fallback local actif.

2. **Alias legacy non supportes**
- `GET /api/users/profile` absent (remplace par `/api/users/me`).
- `PATCH /api/bookings/{id}/status` absent (remplace par `POST /api/bookings/{id}/complete`).
- Impact: front legacy non migre casse.

## P1 - Ecarts contractuels moderes

3. **Format erreurs heterogene**
- Selon endpoint: `{"detail":...}` vs `{"error":...}` vs `{"error":..., "details":[...]}`.
- Action: normaliser cote gateway/front parser defensif par domaine.

4. **Codes HTTP differents de Python sur certaines erreurs**
- Ex: `DataAccessException` mappee `503` en Java (Python etait souvent `500`).
- Action: accepter `500|503` cote front, ou harmoniser via gateway.

5. **Validation code 400 vs 422 sur quelques flux auth**
- Action: front ne doit pas supposer exclusivement `422` pour erreurs validation.

## P2 - Temps reel / UX

6. **Push chat non transporte**
- `ChatPushService` no-op (REST/WS OK mais push device incomplet).

7. **Broadcast notif slice 47 no-op**
- `NotifBroadcaster` no-op.

8. **WS multi-instance**
- Registre connexion process-local; diffusion cross-pod non garantie sans bus.

## Verification compat front effectuee (OK)

- Paths principaux slices 01-48: presents.
- Snake_case majoritairement respecte sur payloads metier sensibles.
- Datetime ISO `+00:00` sur domaines critiques (payments/bookings/notifications).
- Auth flows importants: presentes (JWT, cookie fallback quand requis).
- Status code de base conformes sur nominal et permission matrix.

## Plan de fermeture rapide des gaps

- Exposer `/api/uploads/**` (ou forcer R2 only + URL publique stable).
- Ajouter alias de compat legacy au gateway (ou dans Java si voulu).
- Definir contrat erreurs "front-safe" (parser tolerant par domaine).
- Ajouter bus pub/sub WS si deploiement multi-instance immediat.
