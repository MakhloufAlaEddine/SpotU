# MIGRATION_INTERFACE_CONTRACT.md

**Statut** : contrat d’interface **v1** pour migration Java/Spring, figé à partir du code Python actuel et des arbitrages `ARBITRAGE_DECISIONS.md`.

**Référence exhaustive des chemins** : `ENDPOINTS_CANONICAL_LIST.md` (181 lignes = couples `(méthode, path)` distincts). Ce document **ne duplique pas** toute la table : il fixe **périmètre**, **exclusions** et **règles spéciales**.

**Légende** : **certain** · **déduit** · **recommandé**

---

## 1. Périmètre global v1

| Catégorie | Quantité | Détail |
|-----------|----------|--------|
| Opérations **HTTP** retenues v1 | **177** | Les **178** opérations HTTP distinctes du code (**certain**, `ENDPOINTS_RECONCILIATION.md`) **moins** `POST /api/upload-image/debug-422` (**recommandé** ARB-008 / `RECOMMENDED_CANONICAL_SCOPE.md`). |
| Opérations **WebSocket** retenues v1 | **3** | `WS /api/ws/chat/{conv_id}`, `WS /api/ws/notifications`, `WS /api/ws/spot-you/{point_id}` (**certain**). |
| Opérations **HTTP+WS** totales contrat v1 | **180** | 177 + 3. |

---

## 2. Endpoints HTTP retenus (règle de construction)

- **Inclure** : tout couple `(MÉTHODE, /api/...)` présent dans `ENDPOINTS_CANONICAL_LIST.md` de type **HTTP**, **sauf** l’exclusion §3.1.
- **Collisions** : pour un chemin donné en doublon dans le code Python, **une seule** sémantique Spring — celle des arbitrages **ARB-001** et **ARB-002** (gagnants **déduits** : `payment_routes.admin_subscriptions`, `admin_routes.list_subscription_plans`).
- **Infra / config** : `GET /api/liveness`, `GET /api/readiness`, `GET /api/config/booking`, `GET /api/config/commission` — **retenus** v1 (**recommandé** ARB-011, parité URL).

---

## 3. Exclusions

### 3.1 Exclusions temporaires (hors contrat v1 par défaut)

| Méthode | Path | Motif | Réf. |
|---------|------|--------|------|
| POST | `/api/upload-image/debug-422` | Diagnostic ; commentaire « temporaire » dans le code | ARB-008 (**certain** fichier) |

### 3.2 Exclusions définitives (pas d’équivalent HTTP en Python aujourd’hui)

| Élément | Motif |
|---------|--------|
| Toute route pour **`get_spot_you_members`** | Aucun `@router` sur cette fonction (**certain**) — ARB-006 |
| Second endpoint HTTP pour les **collisions** | Les handlers `subscription_routes.admin_list_plans` / `admin_list_subscriptions` ne forment **pas** une seconde surface `(méthode, path)` joignable si le premier match est celui des arbitrages — ARB-007 (**déduit** sans test runtime) |

### 3.3 Surface technique retenue mais « non-controller métier »

| Type | Path / montage | Implémentation Spring typique |
|------|----------------|-------------------------------|
| Fichiers statiques | `/api/uploads/**` | `ResourceHandlerRegistry` ou équivalent + config volume — ARB-009 / ARB-011 (**certain** côté `server.py`) |

---

## 4. WebSocket retenus v1

Tous **retenus** ; auth décrite dans **ARB-010** (premier message JSON `token`, **certain** dans `chat_routes.py`).

| Path | Handler Python |
|------|----------------|
| `/api/ws/chat/{conv_id}` | `ws_chat` |
| `/api/ws/notifications` | `ws_notifications` |
| `/api/ws/spot-you/{point_id}` | `ws_spot_you` |

---

## 5. Aliases

### 5.1 Aliases **conservés** v1 (parité client / Python)

Les **quatre** chemins suivants doivent exister côté Spring (deux paires, même logique métier par paire) — **certain** (`booking_routes.py`).

| Handler | Chemins |
|---------|---------|
| `my_bookings` | `GET /api/bookings/me`, `GET /api/users/me/bookings` |
| `received_bookings` | `GET /api/bookings/received`, `GET /api/receiver/requests` |

### 5.2 Aliases **non retenus** comme *nouveaux* chemins

- Aucun alias supplémentaire au-delà du Python (pas de nouvelle URL « simplifiée » côté Spring v1).

---

## 6. Double décorateur (non-alias)

| Méthodes | Path | Handler |
|----------|------|---------|
| PUT, PATCH | `/api/services/{service_id}` | `update_service` |

**Décision v1** : **deux** opérations HTTP distinctes en Spring — ARB-003 (**certain**).

---

## 7. Collisions arbitrées (résumé)

| Path | Handler Spring / Python de référence | Certitude ordre |
|------|----------------------------------------|-------------------|
| `GET /api/admin/subscriptions` | `payment_routes.admin_subscriptions` | **déduit** (inclusion avant `subscription_router`) |
| `GET /api/admin/subscription-plans` | `admin_routes.list_subscription_plans` | **déduit** (inclusion avant `subscription_router`) |

---

## 8. Notes importantes pour implémentation Spring

1. **Rate limiting** : routes `auth_routes` avec `@limiter.limit` — reproduire politique ou documenter écart (**déduit** / validation humaine charge sécurité).
2. **Stripe** : `POST /api/webhook/stripe` — pas JWT utilisateur ; signature Stripe (**certain** pattern métier, voir `payment_routes.py` / inventaire).
3. **Workers** (expiry, SpotYou notif, purge médias, etc.) : **hors** contrat HTTP de ce document ; tâches planifiées Spring à traiter séparément (voir audits effets de bord).
4. **OpenAPI** : le contrat v1 est **normatif pour Spring** ; la doc OpenAPI générée côté Python peut ne pas refléter les collisions résolues — aligner la doc générée Spring sur ce fichier.
5. **Validation humaine** : ordre exact des routes sur un environnement réel (confirmation ARB-001/002) ; alignement disque ARB-009.

---

## 9. Fichiers d’audit à consulter en complément

- `ENDPOINTS_CANONICAL_LIST.md` — liste ligne par ligne (auth, notes).
- `ROUTE_COLLISIONS_AND_AMBIGUITIES.md` — ordre `include_router`.
- `ENDPOINTS_RECONCILIATION.md` — comptages et écarts décorateurs / distincts.
