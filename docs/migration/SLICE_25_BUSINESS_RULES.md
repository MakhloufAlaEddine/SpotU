# SLICE_25_BUSINESS_RULES.md — Règles métier
> Basé sur `home_routes.py`.
> Généré le 2026-04-15.

---

## BR-01 — Auth optionnelle (pas require_auth)

```
RÈGLE : Les 2 endpoints utilisent get_token_from_request + decode_jwt en try/except.
        Si le token est absent ou invalide → current_user_id = null.
        Le feed fonctionne SANS auth (mode anonyme), mais le scoring est dégradé
        (pas de tags communs, pas de bonus membre, pas de is_going).
SOURCE : home_routes.py:44–50 (nearest), 164–169 (feed).
PATTERN : Ce n'est PAS require_auth (qui raise 401).
          C'est un decode OPTIONNEL avec catch-all → null.
EN JAVA : Extraire le token dans le filter mais NE PAS bloquer la requête si absent.
          Passer current_user_id (nullable) au service.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-02 — `ST_MakePoint(lng, lat)` : longitude AVANT latitude

```
RÈGLE : PostGIS ST_MakePoint prend (x=longitude, y=latitude).
        Le front envoie ?lat=48.8&lng=2.3 mais le SQL les inverse :
        ST_MakePoint($lng, $lat).
SOURCE : home_routes.py:65 ($1=lng, $2=lat), 210 (idem).
PIÈGE CRITIQUE : Inverser lat/lng → résultats géo complètement faux.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-03 — Auto-expansion du rayon

```
RÈGLE : Le feed commence avec un rayon de 50 km.
        Si le total (spots + services) < 3 → ré-exécute avec 100 km, puis 200 km, puis 500 km.
        La boucle s'arrête dès que total >= 3 OU que tous les rayons sont épuisés.
SOURCE : home_routes.py:24–25 (RADIUS_STEPS, MIN_RESULTS), 194–364 (boucle).
IMPLICATION PERF : Worst case = 4 itérations × 2 requêtes = 8 requêtes PostGIS.
                   Mais dans les zones peuplées, la 1ère itération suffit.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-04 — Exclu le user connecté de ses propres résultats

```
RÈGLE : nearest-sector : `WHERE tp.user_id != $3` (si connecté).
        feed SpotYou : `WHERE tp.user_id != $1` (si connecté).
        feed Services : `WHERE s.coach_id != $1` (si connecté).
        Un utilisateur ne voit PAS ses propres SpotYou ni ses propres services.
SOURCE : home_routes.py:56, 202–204, 300–302.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-05 — Scoring : 3 signaux + bonus

```
RÈGLE : Le score est calculé en application (pas en SQL).
        SpotYou : tags communs (0-40) + popularité (0-30) + distance (0-30) + bonus membre (+20) = max 120
        Services : tags communs (0-40) + popularité (0-30) + distance (0-30) = max 100
SOURCE : home_routes.py:116–147.
POINT : Les coefficients sont hardcodés. Pas de config DB ou env var.
        Tags communs : 20 pts par tag, cap à 40 (max 2 tags efficaces).
        Popularité : normalisée par le max du batch (0 si aucune popularité).
        Distance : inversement proportionnelle, normalisée par le max du batch.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-06 — Popularité SpotYou = going_count + participants_count

```
RÈGLE : La popularité d'un SpotYou est la somme de going_count (présences futures)
        et participants_count (membres inscrits).
SOURCE : home_routes.py:123.
ASYMÉTRIE : La popularité d'un service = booking_count uniquement.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-07 — is_going batch (pas N+1)

```
RÈGLE : Le flag is_going (l'user connecté participe-t-il ?) est résolu en 1 seule
        requête batch pour TOUS les SpotYou du résultat, pas en N requêtes individuelles.
SOURCE : home_routes.py:280–293.
EN JAVA : Utiliser IN clause ou ANY($1::text[]) pour le batch.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-08 — Services : distance via service_locations (pas directe)

```
RÈGLE : Les services n'ont PAS de colonne `location` directe.
        La distance est calculée via la table `service_locations` :
        - Filtre : EXISTS(SELECT 1 FROM service_locations sl WHERE sl.service_id = ... AND ST_DWithin(...))
        - Distance : MIN(ST_Distance(...)) parmi toutes les locations du service.
SOURCE : home_routes.py:308–318.
PIÈGE : Si un service a 0 locations → il n'apparaît JAMAIS dans le feed (EXISTS false).
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-09 — JSONB tag_ids / images parsing double-encodage

```
RÈGLE : Les champs tag_ids et images sont stockés en JSONB mais peuvent être
        retournés comme string (double-encodage asyncpg).
        Le code fait un json.loads() si le champ est un string.
SOURCE : home_routes.py:271–276 (tag_ids), 347–353 (images).
EN JAVA : Si Hibernate/JPA retourne un String au lieu d'un List → ObjectMapper.readValue().
          Ou configurer le converter JSONB correctement.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-10 — Coach object wrapping

```
RÈGLE : Les services dans la réponse ont un objet `coach` qui encapsule
        coach_name, coach_picture, coach_id. Le code pop() les champs plats
        et les remplace par un objet imbriqué.
SOURCE : home_routes.py:391–395.
EN JAVA : Construire un DTO avec un objet `coach` imbriqué au lieu de champs plats.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-11 — Limites : 30 SpotYou + 20 Services max

```
RÈGLE : Le SQL récupère jusqu'à 60 SpotYou et 40 Services par rayon,
        mais la réponse finale est limitée à 30 SpotYou et 20 Services (après scoring).
SOURCE : home_routes.py:262 (LIMIT 60), 339 (LIMIT 40), 398–399 ([:30], [:20]).
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-12 — Feed sans coordonnées (lat/lng absents)

```
RÈGLE : Si lat et lng sont tous deux null → pas de filtre géo, pas de distance,
        pas d'ORDER BY distance. Tous les SpotYou/Services actifs sont retournés
        (LIMIT 60/40) sans tri spatial. Le scoring distance = 0 pour tous.
SOURCE : home_routes.py:218–221 (dist_expr = NULL), 305–306 (idem).
NIVEAU DE CONFIANCE : CERTAIN.
```
