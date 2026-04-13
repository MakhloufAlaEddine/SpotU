# STABILIZATION_SCOPE.md — Périmètre de stabilisation technique
> Basé sur `KNOWN_GAPS_VS_PYTHON.md`, `ARBITRAGE_DECISIONS.md`, `ROUTE_COLLISIONS_AND_AMBIGUITIES.md`, code source Python (`server.py`, `service_routes.py`).
> Généré le 2026-02-XX. Phase de stabilisation avant slices booking/Stripe.

---

## Rappel du contexte

Les slices 01–10 sont migrées. Le backend Java est fonctionnel et testé. Cette phase n'ajoute aucune fonctionnalité. Elle sécurise 5 écarts techniques identifiés avant d'aborder les domaines complexes (booking, Stripe, uploads, WebSockets).

---

## Classification des écarts

### 🔴 BLOQUANT PROD

| # | Écart | Pourquoi bloquant | Fichier de référence |
|---|---|---|---|
| **BP-01** | **CORS wildcard `*`** | `allow_credentials=True` + `allowedOriginPatterns("*")` est invalide selon la spec CORS (navigateurs bloquent). Bloque toutes les requêtes frontend authentifiées en prod | `STABILIZATION_CORS.md` |
| **BP-02** | **Collisions admin** (`GET /api/admin/subscriptions` + `GET /api/admin/subscription-plans`) | Spring Boot lève `IllegalStateException: Ambiguous mapping` au démarrage — le serveur ne démarre pas si ces routes sont incluses sans arbitrage | `STABILIZATION_ADMIN_COLLISIONS.md` |
| **BP-03** | **PostGIS — filtre géo approximatif** | `GET /api/services?lat=X&lng=Y&radius=Z` retourne des résultats incorrects en Java (approximation bounding-box) vs résultats précis en Python (`ST_DWithin` sur géographie sphérique). En prod, les utilisateurs voient des services hors zone ou manquent des services proches | `STABILIZATION_POSTGIS.md` |

### 🟡 IMPORTANT

| # | Écart | Pourquoi important | Fichier de référence |
|---|---|---|---|
| **IMP-01** | **500 vs 503 sur erreur SQL** | Toute la Slice 01–10 retourne HTTP 503 (Java `DataAccessException`) là où Python retourne 500. Si le frontend React Native gère explicitement les codes HTTP (switch 500 vs 503), comportement différent. À aligner selon contrat frontend | `STABILIZATION_HTTP_ERRORS.md` |
| **IMP-02** | **Auth filtre global absent** | Le `SecurityFilterChain` Java autorise tout en `permitAll()`. Les routes protégées (slices 03+) vérifient le JWT dans chaque handler service, comme Python. C'est correct pour les slices actuelles mais fragile : tout nouvel endpoint doit penser à faire sa propre vérification | `KNOWN_GAPS_VS_PYTHON.md — Sécurité` |
| **IMP-03** | **Port / base path** | Python sur 8000, Java sur 8080. Non bloquant si gateway/proxy en place, mais source de confusion sur les environnements partagés. Dépend de la décision d'architecture réseau | `KNOWN_GAPS_VS_PYTHON.md — Parité URL/port` |

### 🟢 AMÉLIORATION

| # | Écart | Impact | Note |
|---|---|---|---|
| **AME-01** | **Message readiness détaillé** | Python affiche `database: pool_not_initialized`. Java simplifié. Utile pour le debug ops mais non fonctionnel | Non critique avant booking |
| **AME-02** | **Uploads + fichiers statiques** | `POST /api/upload-image` + `StaticFiles` absents en Java. Non bloquant si le Java est frontal derrière un gateway qui route vers Python le temps de la migration complète | Slice dédiée |
| **AME-03** | **Workers / rate-limit / Stripe webhook** | Non portés. Non bloquants si Python tourne en parallèle sur ces routes pendant la migration progressive | Slices futures |

---

## Ordre de traitement recommandé

```
1. BP-02 — Collisions admin (Spring Boot ne démarre pas)
     └── Prérequis : aucun
     └── Effort : FAIBLE (choix de handler déjà documenté)

2. BP-01 — CORS wildcard
     └── Prérequis : disposer de la liste d'origines prod
     └── Effort : FAIBLE (une variable d'environnement)

3. BP-03 — PostGIS
     └── Prérequis : extension PostGIS active sur la BDD Java
     └── Effort : MOYEN (SQL natif + driver JDBC)

4. IMP-01 — 500 vs 503
     └── Prérequis : décision humaine (aligner ou documenter l'écart)
     └── Effort : FAIBLE si alignement choisi (GlobalExceptionHandler)

5. IMP-02 — Auth filtre global
     └── Prérequis : aucun
     └── Effort : MOYEN (SecurityFilterChain + liste de routes protégées)

6. IMP-03 — Port / base path
     └── Prérequis : décision d'architecture réseau
     └── Effort : FAIBLE (variable SERVER_PORT)
```

---

## Ce qui doit être fait avant booking (slice 11+)

| Correction | Obligatoire avant booking ? | Raison |
|---|---|---|
| BP-01 CORS | **OUI** | Booking écrit des données → requêtes `POST` cross-origin → bloqué si CORS invalide |
| BP-02 Admin collisions | **OUI** | Spring ne démarre pas avec les routes admin booking si non résolu |
| BP-03 PostGIS | **OUI** | Booking crée des réservations liées à des services localisés — résultats géo incorrects = mauvaises réservations |
| IMP-01 500 vs 503 | **OUI si décision prise** | Booking est le premier domaine financier — comportement d'erreur doit être connu et prévisible |
| IMP-02 Auth filtre | **OUI** | Toutes les routes booking sont protégées — ne pas dépendre uniquement des checks manuels handler par handler |
| IMP-03 Port | **NON** | Résolu par la config déploiement, transparent au code |
