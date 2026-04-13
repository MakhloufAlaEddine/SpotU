# STABILIZATION_PLAN.md — Plan d'action de stabilisation
> Basé sur `STABILIZATION_SCOPE.md`, `STABILIZATION_POSTGIS.md`, `STABILIZATION_HTTP_ERRORS.md`, `STABILIZATION_CORS.md`, `STABILIZATION_ADMIN_COLLISIONS.md`.
> Généré le 2026-02-XX.

---

## Vue d'ensemble

| # | Correction | Criticité | Complexité | Durée estimée | Avant booking ? |
|---|---|---|---|---|---|
| 1 | Admin collisions (BP-02) | BLOQUANT PROD | **FAIBLE** | 30 min | **OUI** |
| 2 | CORS wildcard (BP-01) | BLOQUANT PROD | **FAIBLE** | 1h | **OUI** |
| 3 | PostGIS (BP-03) | BLOQUANT PROD | **MOYEN** | 1–2 jours | **OUI** |
| 4 | 500 vs 503 (IMP-01) | IMPORTANT | **FAIBLE** | 30 min | OUI si décidé |
| 5 | Auth filtre global (IMP-02) | IMPORTANT | **MOYEN** | 1 jour | **OUI** |
| 6 | Port / base path (IMP-03) | IMPORTANT | **FAIBLE** | 15 min | NON |

---

## Étape 1 — Résoudre les collisions admin (BP-02)

**Criticité :** 🔴 BLOQUANT — Spring Boot ne démarre pas  
**Complexité :** FAIBLE  
**Durée :** 30 minutes

### Actions

1. Dans `AdminController.java`, créer deux méthodes distinctes :
   - `GET /api/admin/subscriptions` → basé sur `payment_routes.py:497`
   - `GET /api/admin/subscription-plans` → basé sur `admin_routes.py:210`
2. S'assurer que **aucune route** de `SubscriptionRoutes` (équivalent Java) ne déclare les mêmes chemins
3. Supprimer les handlers morts du périmètre Java (`subscription_routes.py:453`, `subscription_routes.py:151`)

### Validation

```bash
mvn spring-boot:run
# Doit démarrer sans IllegalStateException
# Puis tester :
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8080/api/admin/subscriptions
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8080/api/admin/subscription-plans
```

### Dépendances

Aucune prérequis — peut être fait immédiatement.

---

## Étape 2 — Corriger CORS (BP-01)

**Criticité :** 🔴 BLOQUANT — toutes les requêtes authentifiées bloquées en prod  
**Complexité :** FAIBLE  
**Durée :** 1 heure

### Actions

1. Créer ou modifier `CorsConfig.java` (voir `STABILIZATION_CORS.md` pour le code complet)
2. Remplacer `allowedOriginPatterns("*")` par `allowedOrigins(origins[])` depuis variable d'env
3. Configurer `APP_CORS_ALLOWED_ORIGINS` dans `application.properties` :
   ```
   app.cors.allowed-origins=${APP_CORS_ALLOWED_ORIGINS:http://localhost:3000}
   ```
4. Déployer avec la variable correcte pour chaque environnement

### Validation

```bash
# Test CORS depuis la vraie origine frontend
curl -sI \
  -H "Origin: https://app.spotu.app" \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/domains

# Attendu :
# Access-Control-Allow-Origin: https://app.spotu.app  (PAS *)
# Access-Control-Allow-Credentials: true
```

### Dépendances

Nécessite de connaître la liste exacte des origines (frontend mobile, web admin, localhost dev).

---

## Étape 3 — Corriger PostGIS (BP-03)

**Criticité :** 🔴 BLOQUANT — résultats géo incorrects  
**Complexité :** MOYEN  
**Durée :** 1–2 jours

### Actions

1. Vérifier que PostGIS est actif sur le cluster PostgreSQL cible :
   ```sql
   SELECT PostGIS_version();
   ```
2. Dans `ServiceRepository.java`, remplacer l'approximation bounding-box par le SQL natif PostGIS :
   ```java
   // Voir STABILIZATION_POSTGIS.md pour le SQL exact
   "EXISTS (SELECT 1 FROM service_locations sl " +
   "WHERE sl.service_id = s.service_id " +
   "AND ST_DWithin(sl.location::geography, " +
   "  ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?))"
   // Paramètres : lng, lat, radius (ordre LONGITUDE d'abord)
   ```
3. Mettre à jour l'extraction des coordonnées (lecture) :
   ```sql
   ST_X(location::geometry) as longitude,
   ST_Y(location::geometry) as latitude
   ```
4. Adapter le profil de test pour mocker les appels géo (H2 ne supporte pas PostGIS)

### Validation

```bash
# Coordonnées d'un service existant connu + rayon
curl "http://localhost:8080/api/services?lat=48.8566&lng=2.3522&radius=5000"

# Comparer avec Python :
curl "http://localhost:8001/api/services?lat=48.8566&lng=2.3522&radius=5000"

# Les service_id doivent être identiques dans les deux réponses
```

### Dépendances

- PostGIS doit être activé sur le cluster
- Aucune dépendance Maven supplémentaire (JDBC standard suffit)

---

## Étape 4 — Aligner 500 vs 503 (IMP-01)

**Criticité :** 🟡 IMPORTANT  
**Complexité :** FAIBLE  
**Durée :** 30 minutes (si décision prise)

### Décision humaine requise avant implémentation

Vérifier dans le code React Native :
- Le frontend gère-t-il HTTP 503 différemment de 500 ?
- Le frontend lit-il le champ `detail` ou `error`/`message` ?

### Si alignement décidé

```java
// GlobalExceptionHandler.java
// Option A : conserver 503 mais aligner le corps JSON
@ExceptionHandler(DataAccessException.class)
public ResponseEntity<Map<String, Object>> handleDataAccess(DataAccessException ex) {
    return ResponseEntity.status(503)
        .body(Map.of("detail", "Service temporairement indisponible"));
}

// Option B : aligner complètement sur 500
@ExceptionHandler(DataAccessException.class)
public ResponseEntity<Map<String, Object>> handleDataAccess(DataAccessException ex) {
    return ResponseEntity.status(500)
        .body(Map.of("detail", "Internal Server Error"));
}
```

### Validation

```bash
# Simuler une panne DB (désactiver temporairement la connexion)
curl http://localhost:8080/api/domains
# Vérifier le code HTTP retourné (503 ou 500 selon la décision)
```

---

## Étape 5 — Auth filtre global (IMP-02)

**Criticité :** 🟡 IMPORTANT (risque sur slices futures)  
**Complexité :** MOYEN  
**Durée :** 1 jour

### Problème actuel

Toutes les routes sont en `permitAll()` dans `SecurityFilterChain`. Les vérifications JWT sont faites manuellement dans chaque handler/service. C'est acceptable pour les slices 01–10, mais fragile pour les slices booking/Stripe où chaque oubli = endpoint non protégé.

### Actions recommandées

1. Identifier la liste des routes publiques (slices 01–10) :
   - Toujours publics : `/api/domains`, `/api/tags/**`, `/api/liveness`, `/api/readiness`, `/api/config/**`
   - Auth optionnelle : `/api/services`, `/api/services/{id}`, `/api/users/{id}/public`, `/api/users/{id}/followers`, `/api/users/{id}/following`, `/api/users/{id}/reviews`
   - Auth stricte : `/api/auth/me`, `/api/users/me`

2. Configurer `SecurityFilterChain` :
   ```java
   http.authorizeHttpRequests(auth -> auth
       .requestMatchers("/api/liveness", "/api/readiness").permitAll()
       .requestMatchers("/api/config/**").permitAll()
       .requestMatchers("/api/domains", "/api/tags/**").permitAll()
       .requestMatchers(HttpMethod.GET, "/api/services").permitAll()
       .requestMatchers(HttpMethod.GET, "/api/services/{id}").permitAll()
       .requestMatchers(HttpMethod.GET, "/api/users/{id}/public").permitAll()
       .requestMatchers(HttpMethod.GET, "/api/users/{id}/followers").permitAll()
       .requestMatchers(HttpMethod.GET, "/api/users/{id}/following").permitAll()
       .requestMatchers(HttpMethod.GET, "/api/users/{id}/reviews").permitAll()
       // Routes booking (et suivantes) → authentification requise par défaut
       .requestMatchers("/api/bookings/**").authenticated()
       .requestMatchers("/api/admin/**").hasRole("ADMIN")
       .anyRequest().authenticated()
   );
   ```

3. Retirer les vérifications manuelles redondantes dans les handlers où Spring prend le relais

### Dépendances

- Doit être fait AVANT les slices booking (slices 11+)
- Liste des routes protégées à valider avec le code Python

---

## Étape 6 — Port / base path (IMP-03)

**Criticité :** 🟢 NON BLOQUANT  
**Complexité :** FAIBLE  
**Durée :** 15 minutes

### Action

```properties
# application.properties
server.port=${SERVER_PORT:8080}
```

Ajuster le gateway/proxy pour router vers le bon port selon l'environnement.

---

## Ordre de priorité final

```
Sprint stabilisation (avant booking) :
╔══════════════════════════════════════════════════════════════╗
║  JOUR 1 matin    : Étape 1 (admin collisions) — 30 min       ║
║  JOUR 1 après-m  : Étape 2 (CORS) — 1h                      ║
║  JOUR 2–3        : Étape 3 (PostGIS) — 1–2 jours             ║
║  JOUR 4          : Étape 5 (auth filtre global) — 1 jour     ║
║                                                              ║
║  Après décision humaine :                                    ║
║  JOUR 4 ou 5     : Étape 4 (500 vs 503) — 30 min             ║
╚══════════════════════════════════════════════════════════════╝

Non urgent :
  - Étape 6 (port) — configurable au déploiement
```

---

## Checklist avant Slice 11 (booking)

- [ ] Spring Boot démarre sans `IllegalStateException` (collisions résolues)
- [ ] CORS configuré avec origines explicites — vérifié depuis navigateur
- [ ] `GET /api/services?lat=X&lng=Y` retourne les mêmes résultats que Python
- [ ] Comportement 500/503 documenté et aligné sur la décision humaine
- [ ] `SecurityFilterChain` protège `/api/bookings/**` par défaut
- [ ] Tests de régression exécutés (`mvn test`) sur slices 01–10 après corrections

---

## Risque si stabilisation ignorée

| Écart ignoré | Conséquence en prod booking |
|---|---|
| CORS wildcard | Tous les `POST /bookings` bloqués par le navigateur |
| Admin collisions | Spring Boot ne démarre pas dès que les routes admin booking sont incluses |
| PostGIS approximatif | Les clients voient des services dans leur zone mais ne peuvent pas réserver (mauvaise géoloc) |
| Auth filtre absent | Un endpoint booking oublié → non protégé → données financières exposées |
