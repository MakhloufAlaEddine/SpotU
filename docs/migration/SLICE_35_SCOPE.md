# SLICE_35_SCOPE.md — Cadrage de la Slice 35
> Basé sur `webhook_handlers.py:458–582, 973–976, 1013–1015`.
> Généré le 2026-04-25.

---

## Flow choisi — Stripe Webhook **Charge / Refund Handlers** (`_handle_charge_event` complet) — 0 endpoint nouveau

S35 ne crée **pas** de nouvel endpoint REST. Elle **populate** la slice S32 en activant le set `_CHARGE_EVENTS` et en portant `_handle_charge_event`.

| # | Méthode | Chemin API | Auth | Complexité | Fichier : Lignes |
|---|---|---|---|---|---|
| — | (aucun nouvel endpoint) | `POST /api/webhook/stripe` (S32 réutilisé) | signature HMAC | **MOYENNE** | `webhook_handlers.py` : 458–582 |

### Périmètre fonctionnel exact

**2 events Stripe traités** (set `_CHARGE_EVENTS`, lignes 973–976) :

| Event Stripe | Transition `payments` | Notification | Cas |
|---|---|---|---|
| `charge.refunded` (refunded=true, full) | → `refunded` + `refund_amount` + `refund_status='succeeded'` + `stripe_charge_id` (COALESCE) | 1 notif `payment_refunded` payer ("Remboursement effectué") | Full refund |
| `charge.refunded` (refunded=false, partial) | → `partially_refunded` + `refund_amount` + `refund_status='succeeded'` + `stripe_charge_id` (COALESCE) | 1 notif `payment_refunded` payer ("Remboursement partiel") | Partial refund |
| `refund.updated` (status=succeeded, amount==total, payment_id résolu via charge) | → `refunded` + `refund_status='succeeded'` + `refund_amount` | **Pas de notif** (early return) | Edge case full-refund via `refund.updated` direct |
| `refund.updated` (autre cas, payment_id résolu) | UPDATE `refund_status` uniquement | **Pas de notif** | Sync statut refund (pending/succeeded/failed/canceled) |
| `refund.updated` (payment_id introuvable) | log DEBUG + skip | aucune | Refund Stripe orphelin |

> Note : `charge.refunded` est **toujours** envoyé par Stripe pour un remboursement nominal. `refund.updated` est un événement **complémentaire** qui suit le cycle de vie d'un Refund object Stripe (peut arriver avant ou après `charge.refunded`).

### Ce qui est explicitement HORS périmètre Slice 35
- `_handle_subscription_event` (lignes 586–977) → **Slice 36** ou ultérieur
- Set `_SUBSCRIPTION_EVENTS` populated → S36
- Endpoint REST de demande de remboursement (s'il existe — non visible dans `payment_routes.py`) → hors scope car cette slice ne couvre QUE le webhook
- Disputes (`charge.dispute.*`) → non présents dans `_CHARGE_EVENTS` Python actuel — **pas dans le scope** (compat stricte)
- `payment_intent.refunded` (s'il existe) → non listé dans Python ; ne pas ajouter

> Justification du split : S35 ferme le **cycle de vie paiement** (capture → refund) côté webhook. S36/S37 traiteront les abonnements qui ont leur propre lifecycle complexe (~400 lignes Python).

---

## Pourquoi cette slice — Justification du choix

| Critère | Justification |
|---|---|
| **Ferme le cycle de vie paiement complet** | Sans S35, les `payments` Java restent en `captured` éternellement même après remboursement. Le front (S34) afficherait un statut faux. **S35 est le complément naturel de S33.** |
| **Visible côté front via S34** | Le buyer consulte `/payments/me` (S34) ; sans S35, il ne voit jamais `status='refunded'`. **Améliore directement l'UX consultation paiements.** |
| **Pré-requis déjà fait par S33** | `_resolve_payment_id` strat. 4 (lookup par `stripe_charge_id`) a été porté en S33. **Aucune nouvelle infra à créer.** |
| **Mini-slice serrée** | 2 events, ~125 lignes Python, 1 table principale (`payments`). Auto-suffisant. |
| **Notifications réutilisent infra S33** | `pending_notifs` + `store_notification` du dispatcher S32-S33. Aucune nouvelle plomberie. |
| **Risque métier modéré** | Transitions `captured → refunded/partially_refunded`. Pas d'écriture cross-table (pas de `bookings` update). Calculs montants `cents/100` = piège classique. |
| **Indépendant des subscriptions** | S35 ne touche pas `_SUBSCRIPTION_EVENTS` ni `user_subscriptions`. Migrable en parallèle de S36 si besoin. |
| **Refunds = critique business** | Litiges/conflits clients. Si la migration Java n'a pas les refunds, le support client dispose de données obsolètes. **Bloqueur cutover prod.** |

### Alternatives écartées

| Alternative | Pourquoi non |
|---|---|
| **Subscriptions complets (`_SUBSCRIPTION_EVENTS` + 6 events + handler ~400 lignes)** | Énorme. Lifecycle complexe (created/updated/deleted/invoice paid/failed). Casse la règle slice-précise. **À reporter en S36.** |
| **Booking reads (`/bookings/me` + `/bookings/{id}`)** | Pattern identique à S34 mais sur une autre table. Utile mais **pas directement lié au paiement**. Le front peut déjà afficher les payments via S34, les bookings sont plus complexes (statuts, dates). À reporter (S36+). |
| **Chat / WebSocket** | 700+ lignes, pattern stateful. **Slice dédiée plus tard.** |
| **Push notifications (Expo)** | Périphérie : déjà fonctionnel via `store_notification` (DB + WebSocket). Le push Expo réel (`send_push_notification`) est une optimisation, pas un bloqueur fonctionnel. |
| **`PATCH /payments/{id}/stripe`** | Endpoint admin override. Très peu utilisé. **Pas urgent.** |
| **Bundle refunds + disputes** | Disputes (`charge.dispute.*`) ne sont **pas** dans `_CHARGE_EVENTS` Python. Compat stricte = ne pas ajouter. |

---

## Fichiers Python analysés

| Fichier | Lignes | Rôle |
|---|---|---|
| `webhook_handlers.py` | 458–536 | `_handle_charge_event` branche `charge.refunded` (full + partial) |
| `webhook_handlers.py` | 538–582 | `_handle_charge_event` branche `refund.updated` (sync + edge case full) |
| `webhook_handlers.py` | 973–976 | Set `_CHARGE_EVENTS = {charge.refunded, refund.updated}` — **POPULATE en S35** |
| `webhook_handlers.py` | 1013–1015 | Branche dispatcher `if event_type in _CHARGE_EVENTS:` — **ACTIVER en S35** |
| `webhook_handlers.py` | 122–180 | `_resolve_payment_id` (déjà porté en S33, **réutilisé en S35**) |

**Hors périmètre mais cités** :
- `webhook_handlers.py:586–977` `_handle_subscription_event` (S36+)

---

## Dépendances

| Dépendance | Type | Obligatoire | Commentaire |
|---|---|---|---|
| Slice 32 | Infra webhook | **OUI** | Endpoint, signature, idempotence event-level |
| Slice 33 | Resolver + handler payment | **OUI** | `_resolve_payment_id` strat. 4 (charge_id), `NotificationService` réutilisé |
| Slice 30 / S33 | Données amont | **OUI** | Les payments doivent avoir `status='captured'` + `stripe_charge_id` populé pour qu'un refund ait du sens |
| Table `payments` | DB UPDATE | OUI | Colonnes `status`, `refund_amount`, `refund_status`, `stripe_charge_id`, `updated_at` |
| Table `payments` | DB SELECT | OUI | `payer_user_id` (notif) + `payer_total_amount` (edge case refund.updated) + lookup par `stripe_charge_id` |
| Table `notifications` | DB INSERT | OUI | Via `store_notification` (S33) |
| Logger `webhook_handlers` | Logging | OUI | Traces "Remboursement", "refund.updated" |

---

## Niveau de risque

**MOYEN.**

| Point | Risque | Impact Java |
|---|---|---|
| **Conversion centimes → euros** | TRÈS ÉLEVÉ | Stripe envoie `amount_refunded` en **centimes**. Python fait `round(cents/100, 2)`. Java : `BigDecimal.divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP)`. **Erreur de division** → montants 100x trop grands ou trop petits. |
| **Détection full vs partial** | ÉLEVÉ | `charge.refunded.refunded` est un **boolean** (`True/False`). NE PAS comparer `amount_refunded == total` pour détecter full (le float compare est piégeux). Java : `Boolean.TRUE.equals(obj.get("refunded"))`. |
| **`COALESCE(stripe_charge_id, $4)`** | MOYEN | Le `stripe_charge_id` peut être déjà set (par PI succeeded S33). Python utilise `COALESCE` pour ne PAS l'écraser. Java : reproduire `COALESCE(stripe_charge_id, :ch)` dans la query native. |
| **Edge case `refund.updated` + full refund** | ÉLEVÉ | Si `payment_id` introuvable initialement + lookup par charge → SI `refund.status='succeeded'` ET `amount ≈ payer_total_amount` (tolérance 0.02) → set `status='refunded'` + **early return**. Sinon : UPDATE simple `refund_status` seul. **Logique en 2 phases.** |
| **Tolérance `abs(amount - total) < 0.02`** | MOYEN | Float arithmetic. Java : `amount.subtract(total).abs().compareTo(BigDecimal("0.02")) < 0`. |
| **Notification UNIQUEMENT pour `charge.refunded`** | MOYEN | `refund.updated` n'émet **AUCUNE** notif (le commentaire Python dit "charge.refunded l'a déjà envoyée"). Asymétrie volontaire. |
| **Idempotence guard `WHERE status NOT IN ('refunded')`** | MOYEN | UPDATE `charge.refunded` autorise `captured → refunded` ET `partially_refunded → refunded`. Bloque `refunded → refunded` (déjà final). |
| **Format log `%.2f€` exact** | FAIBLE | `"Remboursement : payment=%s | amount=%.2f€ | full=%s → status=%s"`. Java : `String.format("%.2f€", amount)` ou SLF4J avec format spécifique. |
| **Body notif `f"{amount_refunded:.2f} €"` exact** | FAIBLE | Format `"51.75 €"` avec espace insécable potentiel ? **Vérifier le code Python : c'est un espace simple.** |

---

## Résumé ultra court

- **Events choisis (2)** :
  1. `charge.refunded` — transition `captured → refunded` (full) ou `→ partially_refunded` (partial), set `refund_amount` + `refund_status='succeeded'` + `stripe_charge_id` COALESCE, notif payer
  2. `refund.updated` — sync `refund_status` (pending/succeeded/failed/canceled). Edge case : si payment trouvé via charge_id ET refund succeeded ET amount==total → marquer `refunded` + early return. Pas de notif.

- **Tables touchées** :
  - **WRITE** : `payments` (status, refund_amount, refund_status, stripe_charge_id, updated_at) + `notifications` (via dispatcher S32-S33)
  - **READ** : `payments` (payer_user_id pour notif, payer_total_amount pour edge case full-refund, lookup par stripe_charge_id)
  - **PAS touchées** : `bookings` (asymétrie vs S33), `subscriptions`, `refunds` (Stripe-side seul)

- **Top 3 pièges** :
  1. **Centimes → euros** : Stripe envoie `amount_refunded` en centimes. `BigDecimal.divide(100, 2, HALF_UP)` obligatoire. Une simple `/100` en `int` arrondit vers le bas → 51 € au lieu de 51.75 €.
  2. **Détection full/partial via boolean `refunded`** : utiliser `obj.refunded` (Boolean), **pas** comparer `amount_refunded == amount`. Le float compare est piégeux et le code Python privilégie le boolean.
  3. **Edge case `refund.updated` + full-refund early return** : flow en 2 phases (lookup payment via charge → SI succeeded ET amount==total avec tolérance 0.02 → mark refunded + return ; SINON UPDATE refund_status seul). Facile à oublier ou mal porter.

- **Raison du choix** : Slice 35 ferme le **cycle de vie paiement complet** côté webhook. Le pré-requis (`_resolve_payment_id` strat. 4) est déjà fait en S33. Mini-slice (~125 lignes, 2 events, 1 table). **Visible directement côté front** via S34 (`/payments/me` montrera `status='refunded'`). Sans S35, le support client opère sur des données obsolètes et le buyer voit des paiements "captured" qu'il a pourtant été remboursés. **Bloqueur cutover prod.** Subscriptions (S36) reste isolé car son lifecycle est ~3x plus gros.
