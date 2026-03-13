# SpotU — Estimation Complète des Coûts de Gestion
## Business Plan Technique — Version Production

---

## 1. INVENTAIRE COMPLET DE L'APPLICATION

### Stack technique
| Composant | Technologie | Complexité |
|-----------|------------|-----------|
| Backend API | FastAPI (Python) — 8 765 lignes, 13 modules de routes, 143 endpoints | Haute |
| Base de données | PostgreSQL — 30 tables, 72 index, requêtes géospatiales | Haute |
| Frontend Mobile | React Native / Expo — 86 fichiers TS/TSX, iOS + Android + Web | Haute |
| Temps réel | WebSockets (chat + notifications) | Moyenne |
| Paiements | Stripe (abonnements + paiements ponctuels) | Haute |
| Auth | JWT custom + Google OAuth (Emergent) | Moyenne |
| Géolocalisation | Google Places API + expo-location | Moyenne |
| Push notifications | Expo Push Notifications | Basse |
| Upload fichiers | Stockage local (à migrer S3) | Basse |
| Workers background | Expiry worker + SpotYou notif worker | Basse |

### Modules fonctionnels
- Authentification (email/password + Google OAuth)
- Carte interactive géolocalisée (tag points, services, SpotYou)
- Système de réservation complet (slots, packages, paiement)
- Chat temps réel (WebSocket)
- Notifications push (Expo)
- Gestion de services (CRUD, images, localisations)
- Système de follow/followers
- Avis et notes
- Abonnements Stripe (plans, facturation récurrente)
- Administration (users, tags, domaines, stats)
- Onboarding multi-étapes
- Mode offline partiel

---

## 2. COÛTS D'HÉBERGEMENT (Infrastructure)

### Scénario A : Lancement (0-1 000 users)

| Service | Provider recommandé | Spécification | Coût/mois |
|---------|-------------------|---------------|-----------|
| Serveur API | DigitalOcean Droplet / Railway | 2 vCPU, 4 GB RAM | 24 EUR |
| PostgreSQL | DigitalOcean Managed DB | 1 vCPU, 1 GB RAM, 10 GB | 15 EUR |
| Stockage images | AWS S3 | 10 GB + transfert | 3 EUR |
| CDN | Cloudflare (Free) | Cache statique | 0 EUR |
| Domaine | .app / .com | 1 domaine | 1 EUR |
| SSL | Let's Encrypt | Gratuit | 0 EUR |
| **TOTAL HÉBERGEMENT** | | | **43 EUR/mois** |

### Scénario B : Croissance (1 000-10 000 users)

| Service | Provider recommandé | Spécification | Coût/mois |
|---------|-------------------|---------------|-----------|
| Serveur API | AWS ECS / DigitalOcean App Platform | 4 vCPU, 8 GB RAM, auto-scale | 80 EUR |
| PostgreSQL | AWS RDS / DO Managed DB | 2 vCPU, 8 GB RAM, 100 GB SSD | 95 EUR |
| Redis | AWS ElastiCache / DO Redis | 1 GB cache | 15 EUR |
| Stockage images | AWS S3 | 100 GB | 8 EUR |
| CDN | Cloudflare Pro / AWS CloudFront | Images + API cache | 20 EUR |
| Monitoring | Datadog / Grafana Cloud | Basic plan | 25 EUR |
| Backup DB | Automatique managed DB | Snapshot quotidien | inclus |
| **TOTAL HÉBERGEMENT** | | | **243 EUR/mois** |

### Scénario C : Scale (10 000-100 000 users)

| Service | Provider recommandé | Spécification | Coût/mois |
|---------|-------------------|---------------|-----------|
| Cluster API | AWS EKS / GKE | 3 nœuds, 16 vCPU total, auto-scale | 350 EUR |
| PostgreSQL | AWS RDS Multi-AZ | 4 vCPU, 32 GB RAM, 500 GB + read replica | 450 EUR |
| Redis Cluster | AWS ElastiCache | 2 nœuds, 8 GB | 80 EUR |
| S3 + CloudFront | AWS | 1 TB stockage, 5 TB transfert | 80 EUR |
| ElasticSearch | AWS OpenSearch | 2 nœuds, recherche full-text | 200 EUR |
| Load Balancer | AWS ALB | Auto-scaling | 25 EUR |
| Monitoring | Datadog Pro | Full APM | 100 EUR |
| WAF / DDoS | Cloudflare Business | Protection | 200 EUR |
| **TOTAL HÉBERGEMENT** | | | **1 485 EUR/mois** |

---

## 3. COÛTS DES SERVICES TIERS (SaaS / API)

| Service | Utilisation | Pricing | Coût estimé 1K users | Coût estimé 10K users |
|---------|------------|---------|---------------------|----------------------|
| **Stripe** | Paiements + Abonnements | 1.4% + 0.25 EUR/transaction (EU) | 50-150 EUR* | 500-1 500 EUR* |
| **Google Places API** | Autocomplétion adresses | 2.83 EUR / 1 000 requêtes | 15 EUR | 80 EUR |
| **Expo Push** | Notifications push | Gratuit jusqu'à 1 000/jour, puis 99 USD/mois | 0 EUR | 99 EUR |
| **Emergent Auth** | Google OAuth | Inclus dans plan | 0 EUR | 0 EUR |
| **Apple Developer** | App Store publication | 99 USD/an | 8 EUR | 8 EUR |
| **Google Play** | Play Store publication | 25 USD one-time | 2 EUR (amorti) | 2 EUR (amorti) |
| **Email transactionnel** | SendGrid / Resend | Confirmations, réinitialisation mdp | 0 EUR (free tier) | 20 EUR |
| **SMS (optionnel)** | Twilio | Vérification téléphone | 0 EUR | 50 EUR |
| **TOTAL SERVICES** | | | **75-175 EUR/mois** | **759-1 759 EUR/mois** |

> *Stripe : les frais sont prélevés sur les transactions, pas un coût fixe. Estimation basée sur 100-500 transactions/mois à 1K users et 1 000-5 000 transactions/mois à 10K users avec panier moyen de 30 EUR.

---

## 4. COÛTS DE DÉVELOPPEMENT & MAINTENANCE

### Estimation effort de développement initial (déjà réalisé)

| Module | Effort estimé | Équivalent freelance |
|--------|--------------|---------------------|
| Backend API (8 765 lignes) | 25-30 jours | 7 500-12 000 EUR |
| Frontend Mobile (86 fichiers) | 35-45 jours | 10 500-18 000 EUR |
| Base de données (30 tables) | 5-8 jours | 1 500-3 200 EUR |
| Intégrations (Stripe, Maps, Push) | 8-12 jours | 2 400-4 800 EUR |
| Tests + Debug | 10-15 jours | 3 000-6 000 EUR |
| Design UX/UI | 8-10 jours | 2 400-4 000 EUR |
| **TOTAL DEV INITIAL** | **91-120 jours** | **27 300-48 000 EUR** |

### Maintenance mensuelle continue

| Activité | Fréquence | Effort/mois | Coût freelance/mois |
|----------|-----------|------------|-------------------|
| Bug fixes + patches sécurité | Continu | 2-4 jours | 600-1 600 EUR |
| Mises à jour dépendances (Expo SDK, etc.) | Trimestriel (~1j/mois) | 1 jour | 300-500 EUR |
| Monitoring + alertes + incidents | Continu | 0.5-1 jour | 150-400 EUR |
| Backup vérification + DR test | Mensuel | 0.5 jour | 150-200 EUR |
| Revue sécurité | Trimestriel (~0.5j/mois) | 0.5 jour | 150-200 EUR |
| **TOTAL MAINTENANCE** | | **4.5-7 jours** | **1 350-2 900 EUR/mois** |

### Évolutions fonctionnelles (roadmap)

| Feature | Effort estimé | Coût freelance |
|---------|--------------|---------------|
| i18n complet FR/EN | 5-8 jours | 1 500-3 200 EUR |
| Mutations offline complètes | 8-12 jours | 2 400-4 800 EUR |
| Push notifications production (EAS Build) | 3-5 jours | 900-2 000 EUR |
| Migration S3 + CDN images | 3-4 jours | 900-1 600 EUR |
| Migration PostGIS | 2-3 jours | 600-1 200 EUR |
| Système de modération contenu | 5-8 jours | 1 500-3 200 EUR |
| Analytics / Dashboard KPI | 5-8 jours | 1 500-3 200 EUR |
| Version Android optimisée (EAS Build) | 3-5 jours | 900-2 000 EUR |

---

## 5. COÛTS LÉGAUX & CONFORMITÉ

| Poste | Détail | Coût estimé |
|-------|--------|------------|
| **RGPD / Conformité données** | DPO externe ou audit, privacy policy, CGU | 1 000-3 000 EUR (one-time) + 200 EUR/an |
| **CGV / Mentions légales** | Rédaction juridique (marketplace = complexe) | 1 500-3 000 EUR (one-time) |
| **Conditions d'utilisation** | Modération, responsabilité, litiges | inclus CGV |
| **Assurance RC Pro** | Couvre les litiges plateforme | 300-800 EUR/an |
| **Comptabilité** | Gestion TVA, Stripe, facturation | 100-300 EUR/mois |
| **Marque / INPI** | Dépôt marque SpotU (France) | 190 EUR (one-time) |
| **TOTAL LÉGAL ANNÉE 1** | | **3 290-7 490 EUR** |
| **TOTAL LÉGAL ANNÉES SUIVANTES** | | **1 500-4 400 EUR/an** |

---

## 6. COÛTS MARKETING (Acquisition)

| Canal | Budget mensuel | CAC estimé* | Users acquis/mois |
|-------|---------------|-------------|-------------------|
| **ASO** (App Store Optimization) | 0 EUR (effort interne) | 0 EUR | 20-50 |
| **Réseaux sociaux organiques** | 0 EUR (effort interne) | 0 EUR | 30-100 |
| **Meta Ads (Instagram/Facebook)** | 500-2 000 EUR | 2-5 EUR | 100-1 000 |
| **Google Ads (UAC)** | 300-1 000 EUR | 3-8 EUR | 40-330 |
| **Influenceurs sport local** | 200-500 EUR | 1-3 EUR | 70-500 |
| **Partenariats salles de sport** | 0-200 EUR | 0.5-2 EUR | 100-400 |
| **TOTAL MARKETING** | **1 000-3 700 EUR/mois** | | **360-2 380 users/mois** |

> *CAC = Coût d'Acquisition Client

---

## 7. SYNTHÈSE GLOBALE PAR PHASE

### Phase 1 : MVP / Soft Launch (Mois 1-3)

| Poste | Coût/mois | Coût sur 3 mois |
|-------|-----------|----------------|
| Hébergement | 43 EUR | 129 EUR |
| Services tiers | 75 EUR | 225 EUR |
| Maintenance dev | 1 350 EUR | 4 050 EUR |
| Légal (amorti) | 500 EUR | 1 500 EUR |
| Marketing | 500 EUR | 1 500 EUR |
| **TOTAL** | **2 468 EUR/mois** | **7 404 EUR** |

### Phase 2 : Croissance (Mois 4-12)

| Poste | Coût/mois | Coût sur 9 mois |
|-------|-----------|----------------|
| Hébergement | 243 EUR | 2 187 EUR |
| Services tiers | 400 EUR | 3 600 EUR |
| Maintenance dev | 2 000 EUR | 18 000 EUR |
| Évolutions (i18n, S3, push) | 1 500 EUR | 13 500 EUR |
| Légal (amorti) | 200 EUR | 1 800 EUR |
| Marketing | 2 000 EUR | 18 000 EUR |
| **TOTAL** | **6 343 EUR/mois** | **57 087 EUR** |

### Phase 3 : Scale (Année 2)

| Poste | Coût/mois | Coût annuel |
|-------|-----------|------------|
| Hébergement | 1 485 EUR | 17 820 EUR |
| Services tiers | 1 200 EUR | 14 400 EUR |
| Équipe dev (1 dev full-time) | 4 000 EUR | 48 000 EUR |
| Légal + compta | 400 EUR | 4 800 EUR |
| Marketing | 3 500 EUR | 42 000 EUR |
| **TOTAL** | **10 585 EUR/mois** | **127 020 EUR** |

---

## 8. BUDGET TOTAL ANNÉE 1

| Poste | Montant |
|-------|---------|
| Développement initial (déjà réalisé via Emergent) | 27 300-48 000 EUR* |
| Hébergement (12 mois progressif) | 2 316 EUR |
| Services tiers (12 mois) | 3 825 EUR |
| Maintenance + évolutions dev | 35 550 EUR |
| Légal + conformité | 4 500 EUR |
| Marketing | 22 500 EUR |
| **TOTAL ANNÉE 1 (hors dev initial)** | **68 691 EUR** |
| **TOTAL ANNÉE 1 (avec dev initial)** | **96 000-117 000 EUR** |

> *Le développement initial est en grande partie amorti si réalisé via Emergent.

---

## 9. SEUIL DE RENTABILITÉ

### Hypothèses de revenus
| Source | Revenu/user/mois | Taux conversion |
|--------|-----------------|----------------|
| Abonnement Coach (Premium) | 29.99 EUR | 5% des coachs |
| Commission réservation | 2-5 EUR | 10% des users |
| Abonnement Pro Coach | 49.99 EUR | 2% des coachs |

### Break-even estimé

| Scénario | Users nécessaires | Revenus/mois | Break-even |
|----------|------------------|-------------|-----------|
| Phase 1 (2 468 EUR/mois) | ~500 users actifs | 2 500 EUR | Mois 6-8 |
| Phase 2 (6 343 EUR/mois) | ~2 000 users actifs | 6 500 EUR | Mois 12-15 |
| Phase 3 (10 585 EUR/mois) | ~5 000 users actifs | 11 000 EUR | Mois 18-24 |

---

## 10. RISQUES & MITIGATION

| Risque | Impact | Probabilité | Mitigation | Coût mitigation |
|--------|--------|------------|-----------|----------------|
| Panne serveur | Élevé | Faible | Multi-AZ, monitoring 24/7 | inclus hébergement |
| Fuite de données | Critique | Faible | Audit sécu, chiffrement, RGPD | 2 000 EUR/an |
| Stripe suspension | Élevé | Faible | KYC complet, docs à jour | 0 EUR |
| App Store rejet | Moyen | Moyen | Guidelines Apple à jour, review pre-submit | 0 EUR |
| Scalabilité DB | Élevé | Moyen | PostGIS + read replica prêts | inclus phase 2 |
| Dépendance Expo Go | Moyen | Élevé | Migration EAS Build (dev builds natifs) | 2 000-4 000 EUR |
