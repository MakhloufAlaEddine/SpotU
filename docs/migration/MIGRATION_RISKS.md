# MIGRATION_RISKS.md — Risques de migration Python/FastAPI → Java/Spring Boot
> Généré le 2026-04-11.

---

## Risques critiques (bloqueront la migration si non traités en amont)

### RISK-01 — Webhook Stripe (idempotence + atomicité)
**Niveau : CRITIQUE**
Le handler `webhook_handlers.py` doit :
1. Déchiffrer la signature Stripe (HMAC)
2. Insérer dans `stripe_webhook_events` (ON CONFLICT → skip)
3. Modifier booking + payment dans une seule transaction
4. Puis envoyer les notifications

En Java, `@Transactional` ne couvre pas les appels HTTP (push, Stripe). Si la transaction DB commit mais que le push échoue, l'état est incohérent. Le code Python actuel a la même faiblesse — à documenter pour ne pas la reproduire ni l'aggraver.
**Action Cursor :** Implémenter en Spring avec `@Transactional` puis notifications après commit (via ApplicationEvent ou Outbox pattern).

---

### RISK-02 — PricingEngine : snapshot immuable
**Niveau : CRITIQUE**
Le `pricing_engine.py` est une fonction pure qui calcule les frais et retourne un objet qui est stocké tel quel en JSONB dans `payments.pricing_rule_snapshot`.
Un bug de portage dans le `PricingService` Java changerait les montants facturés silencieusement.
**Action Cursor :** Tests unitaires exhaustifs du moteur de calcul AVANT migration. Comparer les résultats Python vs Java avec les mêmes entrées.

---

### RISK-03 — Auth JWT : stateless sans blacklist
**Niveau : ÉLEVÉ**
En Python, le logout ne fait rien côté serveur. En Spring Security, il faut reproduire ce comportement exactement.
Si Spring Security est configuré avec session (`HttpSession`), le comportement change et peut créer des divergences.
**Action Cursor :** Configurer `SessionCreationPolicy.STATELESS` + custom `JwtAuthFilter`. Pas de `invalidateHttpSession`.

---

### RISK-04 — PostGIS dans les requêtes SQL brutes
**Niveau : ÉLEVÉ**
Les requêtes spatiales (`ST_DWithin`, `ST_Distance`, `ST_MakePoint`) sont écrites en SQL brut asyncpg.
En JPA, soit on les garde en `@Query(nativeQuery=true)` soit on les réécrit avec Hibernate Spatial.
Le type `geometry(Point,4326)` nécessite `Hibernate Spatial` (5.x ou 6.x) + `postgis-jdbc`.
**Action Cursor :** Ne pas utiliser JPQL pour les requêtes spatiales — garder nativeQuery. Tester `ST_DWithin` avec `::geography` pour le comportement en mètres.

---

### RISK-05 — JSONB dynamique (tag_ids, images, event_schedule, pricing_snapshot)
**Niveau : ÉLEVÉ**
Beaucoup de colonnes JSONB stockent des structures dynamiques (tableaux, objets imbriqués) avec des schémas variables.
asyncpg gère la désérialisation automatiquement (codec custom). En JPA, il faut :
- Soit `@Column(columnDefinition = "jsonb")` + `@Type(JsonType.class)` (Hypersistence Utils)
- Soit des `@Convert(converter = JsonConverter.class)` custom
**Action Cursor :** Utiliser `io.hypersistence:hypersistence-utils-hibernate-60` ou `com.vladmihalcea:hibernate-types`.

---

### RISK-06 — Workers asyncio → Spring @Scheduled
**Niveau : ÉLEVÉ**
5 workers asyncio avec `SELECT … FOR UPDATE SKIP LOCKED` (ExpiryWorker).
En Spring, `@Scheduled` est synchrone par défaut et ne supporte pas nativement `SKIP LOCKED`.
**Action Cursor :** 
- `@Scheduled` + `@Transactional` + `SKIP LOCKED` en nativeQuery dans le repository
- Ou utiliser **Spring Batch** pour les workers à fort volume (ExpiryWorker)
- Le `SKIP LOCKED` est critique pour éviter les doublons si plusieurs instances Spring tournent

---

### RISK-07 — WebSocket (3 canaux différents, auth par query param)
**Niveau : ÉLEVÉ**
L'auth JWT est passée via query param (`?token=JWT`). Spring Security WebSocket filtre par HttpHandshakeInterceptor.
Le canal notifications est global (pas de room) → `SimpMessagingTemplate` ou WebSocket natif.
**Action Cursor :** Ne migrer les WebSockets qu'en last slice. Prévoir STOMP ou Socket.IO pour la compatibilité frontend.

---

### RISK-08 — IDs TEXT non-UUID
**Niveau : MOYEN**
Toutes les PKs sont `TEXT` avec format `{prefix}_{hex12}`. JPA default assume `Long` ou `UUID`.
En Spring, déclarer toutes les PKs `@Id @GeneratedValue(strategy=GenerationType.NONE)` avec génération manuelle dans les entités.
**Action Cursor :** Créer une utilitaire `IdGenerator.generate(prefix)` équivalente au Python `new_id(prefix)`.

---

### RISK-09 — Obfuscation géographique (apply_precision_offset)
**Niveau : MOYEN**
La logique d'obfuscation (`exact|100m|1000m` avec bruit gaussien) est dans `tagpoint_routes.py:apply_precision_offset`.
Si elle est oubliée ou mal portée, les coordonnées exactes fuitent pour tous les SpotYous non-`exact`.
**Action Cursor :** Écrire un test unitaire de la fonction avant migration. Valider avec la même seed gaussienne.

---

### RISK-10 — Logique dispersée entre routes et helpers
**Niveau : MOYEN**
Beaucoup de logique métier est directement dans les fonctions de routes (ex: `_do_booking_request` dans `booking_routes.py` fait 150+ lignes).
Pas de couche Service explicite. En Spring, cette logique doit être extraite dans des `@Service`.
**Action Cursor :** Identifier les blocs fonctionnels dans chaque route et créer les services correspondants avant de tester les controllers.

---

### RISK-11 — Soft delete non filtré automatiquement
**Niveau : MOYEN**
Il n'y a pas de `@Where(clause="deleted_at IS NULL")` Hibernate ni de filtre global.
Chaque requête SQL filtre manuellement `WHERE deleted_at IS NULL`.
En JPA, si un `findAll()` ou `findById()` est utilisé sans filtre → retourne des entités supprimées.
**Action Cursor :** Utiliser `@SQLRestriction("deleted_at IS NULL")` (Hibernate 6) ou `@Where` (Hibernate 5) sur toutes les entités avec soft delete.

---

### RISK-12 — Emergent Proxy Stripe
**Niveau : MOYEN**
Si `STRIPE_API_KEY = "sk_test_emergent"`, les appels Stripe passent par `https://integrations.emergentagent.com/stripe`.
Ce proxy n'est pas disponible en Java (librairie Python uniquement).
**Action Cursor :** En Java, utiliser directement le SDK `stripe-java` avec une vraie clé Stripe. Le proxy Emergent ne doit pas être reproduit.

---

### RISK-13 — Rate limiting (slowapi)
**Niveau : FAIBLE**
Le rate limiting est appliqué par décorateur sur certaines routes. En Spring, il faut configurer Bucket4j ou un filtre servlet.
**Action Cursor :** Mapper les routes avec `@limiter.limit("X/minute")` dans `server.py` et créer un filtre Spring équivalent.

---

### RISK-14 — Google OAuth via Emergent
**Niveau : FAIBLE** (si remplacé par Spring Security OAuth2)
L'appel HTTP vers `demobackend.emergentagent.com` est une dépendance externe propriétaire Emergent.
**Action Cursor :** Remplacer par `spring-security-oauth2-client` avec Google provider. Conserver la même logique UPSERT users.

---

## Zones nécessitant validation humaine avant migration

| Zone | Raison |
|------|--------|
| `pricing_engine.py` | Toute erreur de portage = montants incorrects facturés |
| `webhook_handlers.py` | Séquençage transactions + idempotence Stripe critique |
| `expiry_worker.py` SKIP LOCKED | Multi-instance → doublons d'expiration si non respecté |
| `deletion_routes.py` + `media_purge_worker.py` | Pipeline J+90 : erreur = médias jamais purgés ou purgés trop tôt |
| `apply_precision_offset()` | Fuite de coordonnées GPS exactes si oubliée |
| `spot_you_members` state machine | 4 statuts + 3 canaux d'entrée : logique complexe à ne pas casser |
