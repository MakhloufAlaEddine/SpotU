# SLICE_26_BUSINESS_RULES.md — Règles métier
> Basé sur `tagpoint_routes.py:1–651,1303–1347`.
> Généré le 2026-04-15.

---

## BR-01 — Precision offset : brouillage GPS déterministe

```
RÈGLE : Les SpotYou avec precision="100m" ou "1000m" ont leurs coordonnées
        décalées aléatoirement dans un cercle du rayon correspondant.
        Le décalage est DÉTERMINISTE (random.seed(hash(point_id))) →
        même décalage à chaque appel pour le même SpotYou.
        Exception : le propriétaire voit les coordonnées EXACTES (pas de décalage).
SOURCE : tagpoint_routes.py:78–116, 217–223.
EN JAVA : Reproduire avec `new Random(point_id.hashCode())`.
PIÈGE : Le hash Python (hash(str)) et le hashCode Java (str.hashCode()) donnent
        des résultats DIFFÉRENTS. Les coordonnées décalées seront donc différentes
        entre Python et Java pour le même SpotYou. C'est acceptable car le décalage
        est approximatif (privacy, pas GPS exact).
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-02 — Address masking par precision

```
RÈGLE : build_point_response applique _mask_address(address, precision) :
        - "exact" → adresse complète
        - "100m" → masque le numéro de rue
        - "1000m" → masque le numéro + la rue
        Le propriétaire reçoit l'adresse complète dans `original_address`.
SOURCE : tagpoint_routes.py:68–74.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-03 — Détail : SpotYou inactif → 404 pour non-owner

```
RÈGLE : Si active=false ET l'utilisateur n'est PAS le propriétaire → 404.
        Le propriétaire peut voir son SpotYou même désactivé.
SOURCE : tagpoint_routes.py:417–418.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-04 — Détail : queries parallèles (asyncio.gather)

```
RÈGLE : Le détail utilise asyncio.gather pour exécuter des queries en parallèle.
        Batch 1 (4 queries) : tags, vote_stats, vote_distribution, member_count
        Batch 2 (3 queries, si connecté) : is_participant, is_going, is_saved
        Chaque coroutine acquiert sa propre connexion du pool (_q helper).
SOURCE : tagpoint_routes.py:443–548.
EN JAVA : CompletableFuture.allOf() avec des tâches async, OU séquentiel (plus simple).
PIÈGE : Si le pool de connexions est petit, 4 queries parallèles peuvent le saturer.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-05 — Détail : going_count conditionnel

```
RÈGLE : going_count est calculé UNIQUEMENT si :
        1. L'utilisateur est connecté ET
        2. Il est membre (is_participant=true) ET
        3. next_session_date existe
        Sinon → going_count = null.
        Raison : le going_count est une info réservée aux membres.
SOURCE : tagpoint_routes.py:537–547.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-06 — Search : exclut ses propres SpotYou (si connecté)

```
RÈGLE : La recherche exclut les SpotYou du user connecté (tp.user_id != $N).
        En mode anonyme, tous les SpotYou actifs sont retournés.
SOURCE : tagpoint_routes.py:172–175.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-07 — Search : JSONB `?|` operator pour tags

```
RÈGLE : Le filtre par tag_ids utilise l'opérateur PostgreSQL `?|` :
        `tag_ids ?| ARRAY['tag_001', 'tag_002']` → true si au moins UN tag match.
SOURCE : tagpoint_routes.py:193–196.
EN JAVA : Requête native JPA — l'opérateur ?| est PostgreSQL-spécifique.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-08 — Search : nearest-neighbor sort avec `<->`

```
RÈGLE : Si lat/lng sont fournis, le tri utilise l'opérateur PostGIS `<->`
        (KNN nearest-neighbor) qui exploite l'index GiST pour un tri efficace.
SOURCE : tagpoint_routes.py:202.
EN JAVA : Requête native JPA passthrough.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-09 — Mine/Saved : next_session_date calculé CPU

```
RÈGLE : Le calcul de la prochaine séance est fait en CPU (pas en SQL)
        via get_next_session_date(). Cette fonction analyse le schedule JSONB
        et l'event_date pour déterminer la prochaine occurrence.
SOURCE : tagpoint_routes.py:232,318 — import de spot_you_routes.
EN JAVA : Reproduire la logique dans un service dédié (NextSessionDateCalculator).
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-10 — Mine/Saved : batch queries (pas N+1)

```
RÈGLE : Les enrichissements (participants_count, going_count, is_going) sont
        calculés en BATCH (1 query pour tous les points) au lieu de N queries individuelles.
SOURCE : tagpoint_routes.py:249–298 (mine), 330–387 (saved).
EN JAVA : Utiliser des IN clauses ou ANY($1::text[]).
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-11 — Similar : tags OU distance < 10km

```
RÈGLE : Les SpotYou similaires sont ceux qui partagent au moins 1 tag
        OU sont à moins de 10km. Triés : tags match d'abord, puis distance.
        Max 10 résultats.
SOURCE : tagpoint_routes.py:583–624.
PIÈGE SQL : La requête gère le double-encodage JSONB (jsonb_typeof + #>> '{}').
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-12 — Participants : créateur en premier

```
RÈGLE : La liste des participants est triée avec le créateur (is_creator=true)
        en premier, puis par joined_at ASC.
SOURCE : tagpoint_routes.py:1315.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-13 — TP_FIELDS : sous-requêtes corrélées dans SELECT

```
RÈGLE : La projection TP_FIELDS inclut 3 sous-requêtes corrélées dans le SELECT :
        - AVG(rating) FROM tag_point_votes
        - COUNT(*) FROM tag_point_votes
        - COUNT(*) FROM spot_you_members WHERE status='accepted'
        Ces sous-requêtes sont exécutées pour CHAQUE ligne du résultat.
SOURCE : tagpoint_routes.py:40–42.
PERF : Acceptable pour LIMIT 200, mais coûteux pour des datasets larges.
EN JAVA : Reproduire tel quel (native query).
NIVEAU DE CONFIANCE : CERTAIN.
```
