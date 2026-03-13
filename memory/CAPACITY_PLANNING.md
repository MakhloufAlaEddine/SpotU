# SpotU — Estimation de charge serveur et base de données

## Architecture actuelle

| Composant | Technologie | Port |
|-----------|------------|------|
| API Backend | FastAPI (Python, 1 worker uvicorn) | 8001 |
| Base de données | PostgreSQL | 5432 |
| Frontend | Expo React Native (Web + iOS + Android) | 3000 |
| Fichiers uploadés | Stockage local `/app/backend/uploads/` | - |
| WebSockets | 2 canaux : chat temps réel + notifications | - |
| Workers background | ExpiryWorker (60s) + SpotYouNotifWorker (900s) | - |

### Inventaire des ressources
- **143 endpoints API** (REST) répartis sur 13 fichiers de routes
- **30 tables PostgreSQL** (users, services, bookings, messages, tag_points, etc.)
- **72 index** de base de données
- **2 WebSockets** persistants (chat + notifications)
- **2 workers** en background (expiration bookings + notifications SpotYou)

---

## Scénarios de charge

### Palier 1 : 100-500 utilisateurs (Lancement / MVP)

| Ressource | Spécification | Coût estimé/mois |
|-----------|--------------|-----------------|
| **Serveur API** | 1 vCPU, 2 GB RAM (ex: AWS t3.small / DO Droplet Basic) | 15-25 EUR |
| **PostgreSQL** | Managed DB 1 vCPU, 1 GB RAM, 10 GB SSD (ex: AWS RDS db.t3.micro) | 15-20 EUR |
| **Stockage fichiers** | 5 GB (photos profil + services + SpotYou) — disque local ou S3 | 0-5 EUR |
| **CDN** | Optionnel, CloudFlare Free | 0 EUR |
| **Total** | | **30-50 EUR/mois** |

**Trafic estimé :**
- 50-100 DAU (daily active users)
- ~500 requêtes API/heure en pic
- ~20 WebSocket connexions simultanées
- ~50 MB/jour de données transférées
- ~10-20 uploads images/jour

**Bottleneck probable : Aucun.** Un seul worker FastAPI gère facilement cette charge.

---

### Palier 2 : 500-5 000 utilisateurs (Croissance)

| Ressource | Spécification | Coût estimé/mois |
|-----------|--------------|-----------------|
| **Serveur API** | 2 vCPU, 4 GB RAM, **2-4 workers uvicorn** (ex: AWS t3.medium) | 40-60 EUR |
| **PostgreSQL** | Managed DB 2 vCPU, 4 GB RAM, 50 GB SSD (ex: AWS RDS db.t3.medium) | 50-80 EUR |
| **Stockage fichiers** | S3 + CloudFront CDN, ~50 GB | 10-20 EUR |
| **Redis** | Cache sessions + rate limiting, 1 GB (ElastiCache t3.micro) | 15-20 EUR |
| **Total** | | **115-180 EUR/mois** |

**Trafic estimé :**
- 500-1 000 DAU
- ~5 000 requêtes API/heure en pic
- ~100-200 WebSocket connexions simultanées
- ~500 MB/jour de données transférées
- ~100-200 uploads images/jour

**Actions requises :**
1. **Migrer les uploads vers S3** (le stockage local ne scale pas)
2. **Ajouter Redis** pour le cache et les sessions WebSocket
3. **Passer à 2-4 workers uvicorn** (`--workers 4`)
4. **Ajouter des index PostgreSQL** sur les requêtes géospatiales les plus fréquentes
5. **Activer le connection pooling** (PgBouncer)

---

### Palier 3 : 5 000-50 000 utilisateurs (Scale-up)

| Ressource | Spécification | Coût estimé/mois |
|-----------|--------------|-----------------|
| **Serveur API** | 4 vCPU, 8 GB RAM, **8 workers** + auto-scaling (ECS/Kubernetes) | 150-250 EUR |
| **PostgreSQL** | 4 vCPU, 16 GB RAM, 200 GB SSD + read replica | 200-350 EUR |
| **S3 + CloudFront** | ~500 GB stockage, ~2 TB transfert/mois | 50-80 EUR |
| **Redis Cluster** | 2 nœuds, 4 GB | 40-60 EUR |
| **Load Balancer** | ALB/NLB | 20-30 EUR |
| **Monitoring** | Datadog/Grafana | 20-50 EUR |
| **Total** | | **480-820 EUR/mois** |

**Trafic estimé :**
- 5 000-10 000 DAU
- ~50 000 requêtes API/heure en pic
- ~1 000-2 000 WebSocket connexions simultanées
- ~5 GB/jour de données transférées
- ~1 000-2 000 uploads images/jour

**Actions requises :**
1. **Architecture multi-instance** : API derrière un load balancer
2. **WebSocket sticky sessions** ou migration vers un service dédié (Socket.io + Redis adapter)
3. **PostgreSQL read replica** pour les requêtes de lecture (carte, recherche, feed)
4. **Requêtes géospatiales** : Migrer vers PostGIS pour les requêtes `ST_DWithin` au lieu de calculs Haversine en SQL
5. **Queue de jobs** : Migrer les workers background vers Celery + Redis (ou AWS SQS)
6. **CDN** : Toutes les images servies via CloudFront
7. **Compression images** : Redimensionnement automatique à l'upload (sharp/Pillow)

---

### Palier 4 : 50 000+ utilisateurs (Scale massif)

| Ressource | Spécification | Coût estimé/mois |
|-----------|--------------|-----------------|
| **API Cluster** | Kubernetes 3+ nœuds, auto-scaling, 16+ vCPU total | 500-800 EUR |
| **PostgreSQL** | 8 vCPU, 32 GB RAM, 1 TB SSD + 2 read replicas + PgBouncer | 600-1 000 EUR |
| **S3 + CloudFront** | ~2 TB stockage, ~10 TB transfert/mois | 150-300 EUR |
| **Redis Cluster** | 3 nœuds, 16 GB total | 100-150 EUR |
| **ElasticSearch** | Recherche full-text + géo (3 nœuds) | 200-400 EUR |
| **Queue (SQS/RabbitMQ)** | Notifications, emails, workers | 30-50 EUR |
| **Monitoring + Logging** | Datadog/ELK | 100-200 EUR |
| **Total** | | **1 680-2 900 EUR/mois** |

**Actions requises :**
1. **Sharding géographique** : Partitionner les tag_points et services par zone géo
2. **ElasticSearch** : Recherche full-text, suggestions, filtres complexes
3. **Microservices** : Séparer chat, notifications, bookings en services indépendants
4. **CDN edge** : Cache API pour les données publiques (services, profils coachs)
5. **Database partitioning** : Tables messages et notifications partitionnées par date

---

## Analyse des goulots d'étranglement par composant

### 1. Base de données PostgreSQL

| Table | Croissance | Risque | Optimisation |
|-------|-----------|--------|-------------|
| `messages` | Très rapide (chat) | **ÉLEVÉ** | Partition par mois, archivage |
| `notifications` | Rapide | MOYEN | Purge automatique > 90 jours |
| `tag_points` | Modéré | MOYEN | Index géospatial PostGIS |
| `bookings` | Modéré | FAIBLE | Index composites |
| `services` | Lent | FAIBLE | Cache Redis |
| `users` | Lent | FAIBLE | Aucun |

**Estimation taille DB :**
- 1 000 users : ~100 MB
- 10 000 users : ~2 GB
- 100 000 users : ~20-50 GB

### 2. WebSockets

| Métrique | 1K users | 10K users | 100K users |
|----------|---------|----------|-----------|
| Connexions simultanées | ~200 | ~2 000 | ~20 000 |
| RAM par connexion | ~50 KB | ~50 KB | ~50 KB |
| RAM totale WebSocket | ~10 MB | ~100 MB | ~1 GB |
| Messages/sec | ~10 | ~100 | ~1 000 |

**Seuil critique** : Au-delà de ~5 000 connexions simultanées, il faudra un service WebSocket dédié avec Redis pub/sub.

### 3. Stockage fichiers (Images)

| Métrique | Estimation par user |
|----------|-------------------|
| Photo profil | 200 KB (redimensionnée) |
| Photo couverture | 500 KB |
| Images services (×5) | 1.5 MB |
| Images SpotYou | 300 KB |
| **Total par user actif** | **~2.5 MB** |

- 1 000 users : ~2.5 GB
- 10 000 users : ~25 GB
- 100 000 users : ~250 GB

### 4. Bande passante

| Action | Taille moyenne | Fréquence/user/jour |
|--------|---------------|-------------------|
| Chargement carte (API) | 5-20 KB | 5-10× |
| Chargement feed | 10-30 KB | 3-5× |
| Images (CDN) | 50-200 KB | 10-20× |
| WebSocket (chat) | 0.5-2 KB/msg | 5-20 msg |
| Upload image | 500 KB-2 MB | 0.2× |

**Bande passante estimée par DAU : ~2-5 MB/jour**

---

## Recommandations prioritaires (avant scaling)

### Court terme (avant 1 000 users) — PRIORITAIRE
1. **Migrer uploads vers S3** — Le stockage local est un single point of failure
2. **Compression images à l'upload** — Redimensionner à 1200px max, WebP, qualité 80%
3. **Ajouter des index manquants** — Vérifier les requêtes lentes avec `EXPLAIN ANALYZE`
4. **Rate limiting** — Déjà en place (slowapi), mais vérifier les seuils
5. **Backup automatique DB** — Snapshot quotidien PostgreSQL

### Moyen terme (1 000 - 10 000 users)
6. **Redis** — Cache des profils coachs, services populaires, config app
7. **Workers uvicorn multiples** — Passer de 1 à 4 workers
8. **PgBouncer** — Connection pooling pour éviter l'épuisement des connexions
9. **PostGIS** — Requêtes géospatiales nativement optimisées
10. **Monitoring** — Métriques API (latence p95, error rate), alertes

### Long terme (10 000+ users)
11. **Architecture multi-instance** (Kubernetes/ECS)
12. **Read replicas PostgreSQL**
13. **ElasticSearch pour la recherche**
14. **Microservices** (chat, notifications)
15. **CDN edge caching**

---

## Résumé des coûts

| Palier | Users | DAU | Coût/mois | Coût/user/mois |
|--------|-------|-----|-----------|---------------|
| MVP | 100-500 | 50-100 | 30-50 EUR | 0.10-0.50 EUR |
| Croissance | 500-5K | 500-1K | 115-180 EUR | 0.04-0.23 EUR |
| Scale-up | 5K-50K | 5K-10K | 480-820 EUR | 0.02-0.10 EUR |
| Scale massif | 50K+ | 20K+ | 1.7K-2.9K EUR | 0.03-0.06 EUR |

> Le coût par utilisateur **diminue** fortement avec l'échelle. L'enjeu principal n'est pas le coût serveur mais l'**acquisition et la rétention** des utilisateurs.
