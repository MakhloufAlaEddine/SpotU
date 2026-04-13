# SLICE_19_BUSINESS_RULES.md — Règles métier
> Basé sur `stripe_service.py:136–237`, `booking_routes.py:524–912`, `expiry_worker.py:173–179`.
> Généré le 2026-02-XX.

---

## Règles métier — StripeService (capture, cancel, refund)

### BR-01 — Hors transaction OBLIGATOIRE

```
RÈGLE : Tout appel Stripe réseau (capture, cancel, refund) DOIT être exécuté
        APRÈS le COMMIT de la transaction DB.
RAISON : Un appel réseau peut prendre 1–30 secondes.
         Tenir un lock DB pendant ce temps → risque de deadlock et timeout.
SOURCE : booking_routes.py:524 (capture hors transaction),
         booking_routes.py:726 (cancel hors transaction),
         booking_routes.py:877 (cancel/refund hors transaction),
         expiry_worker.py:173 (cancel hors transaction après COMMIT).
```

**En Java** : la méthode `@Transactional` du controller NE DOIT PAS englober l'appel au StripeService.
Le pattern est :
```
1. transactionalMethod() → DB changes → COMMIT
2. stripeService.xxx()   → réseau (hors @Transactional)
```

### BR-02 — Erreur Stripe avalée (fire-and-forget)

```
RÈGLE : Si l'appel Stripe échoue (réseau, objet Stripe invalide, état incorrect),
        l'erreur est LOGUÉE mais NE provoque PAS de rollback DB ni de HTTP 500.
RAISON : La DB est déjà dans l'état final correct.
         Le webhook Stripe (Slice 16) rattrapera l'état Stripe→DB si nécessaire.
SOURCE : booking_routes.py:529–530 (capture: log.error, pas de raise),
         booking_routes.py:731–732 (cancel: log.error, pas de raise),
         booking_routes.py:903–906 (refund: log.error, pas de raise),
         expiry_worker.py:178–179 (cancel: log.error, continue).
NIVEAU DE CONFIANCE : CERTAIN — les 4 callers ont le MÊME pattern try/except.
```

**En Java** : `try { stripeService.xxx(...); } catch (StripeException e) { log.error(...); }`
Ne PAS déclarer `throws StripeException` dans le controller. Le catch est OBLIGATOIRE dans chaque caller.

### BR-03 — Le StripeService NE touche PAS la DB

```
RÈGLE : Le StripeService est un service pur réseau.
        Il NE doit contenir AUCUN accès DB (pas de repository, pas de @Transactional).
RAISON : La mise à jour DB est la responsabilité du caller (controller/worker).
         Le service est un wrapper autour du SDK Stripe, rien d'autre.
SOURCE : stripe_service.py ne contient AUCUN import de database, pool, ou conn.
NIVEAU DE CONFIANCE : CERTAIN.
```

### BR-04 — Capture : toujours full amount

```
RÈGLE : La capture est TOUJOURS pour le montant total autorisé (full capture).
        Le paramètre amount_to_capture N'EST JAMAIS utilisé dans le code actuel.
SOURCE : booking_routes.py:526 — capture_payment_intent(pi_id_to_capture)
         (pas de 2e argument → full capture)
PIÈGE JAVA : Ne pas implémenter de capture partielle. Passer null pour amount_to_capture.
NIVEAU DE CONFIANCE : CERTAIN.
```

### BR-05 — Cancel PI : mapping raison métier → raison Stripe

```
RÈGLE : La raison passée par le caller est une raison MÉTIER ("refused", "expired", "cancelled").
        Le StripeService la mappe vers une raison STRIPE ("abandoned", "duplicate", "fraudulent")
        via _CANCEL_REASONS. Si la raison métier est inconnue, le fallback est "abandoned".
SOURCE : stripe_service.py:158–164 + 175.
ASYMÉTRIE : Les 3 raisons métier actuelles ("refused", "expired", "cancelled") sont TOUTES
            mappées vers "abandoned". Stripe ne distingue pas ces 3 cas.
NIVEAU DE CONFIANCE : CERTAIN.
```

**Map Java complète** :

| Clé (entrée caller) | Valeur (envoyée à Stripe) |
|---|---|
| `"refused"` | `"abandoned"` |
| `"expired"` | `"abandoned"` |
| `"cancelled"` | `"abandoned"` |
| `"duplicate"` | `"duplicate"` |
| `"fraudulent"` | `"fraudulent"` |
| Toute autre valeur | `"abandoned"` (fallback) |

### BR-06 — Cancel PI : naturellement idempotent

```
RÈGLE : Annuler un PaymentIntent déjà annulé NE lève PAS d'erreur Stripe.
        L'API Stripe retourne le PI avec status="canceled" sans échec.
        MAIS annuler un PI déjà captured LÈVE une StripeException (InvalidRequestError).
SOURCE : Comportement SDK Stripe documenté.
IMPLICATION : Le caller doit vérifier le pay_status AVANT d'appeler cancel.
              Les callers actuels ne passent cancel que si status IN
              ('requires_authorization', 'authorized', 'capture_pending').
              Si un webhook a déjà passé le PI à "captured" entre la lecture DB
              et l'appel cancel → StripeException → avalée (BR-02).
NIVEAU DE CONFIANCE : CERTAIN.
```

### BR-07 — Refund : clé d'idempotence OBLIGATOIRE

```
RÈGLE : Chaque appel à create_refund inclut une idempotency_key.
        Format : "rf_{booking_id}" (le service préfixe "rf_").
        Si Stripe reçoit la même clé une 2e fois → retourne le refund existant (pas de double remboursement).
SOURCE : stripe_service.py:228–229 — kwargs["idempotency_key"] = f"rf_{idempotency_key}"
         booking_routes.py:897 — idempotency_key=booking_id
PIÈGE : En Java, utiliser RequestOptions.builder().setIdempotencyKey("rf_" + bookingId).build()
NIVEAU DE CONFIANCE : CERTAIN.
```

### BR-08 — Refund : charge_id obligatoire, sinon log warning

```
RÈGLE : Le refund nécessite un charge_id (ch_...).
        Si charge_id est NULL (PI jamais captured, ou stockage raté) :
        → PAS d'appel Stripe
        → log.warning("Paiement capturé sans stripe_charge_id — remboursement manuel requis")
        → Le booking est quand même marqué "cancelled" + payment "refunded" en DB.
SOURCE : booking_routes.py:907–912.
IMPACT : Le client n'est PAS remboursé automatiquement. Action manuelle requise.
NIVEAU DE CONFIANCE : CERTAIN.
```

### BR-09 — Refund : raisons validées avec fallback

```
RÈGLE : La raison de refund est validée contre {"requested_by_customer", "fraudulent", "duplicate"}.
        Si la raison n'est pas dans le set → fallback "requested_by_customer".
SOURCE : stripe_service.py:197 + 217.
USAGE ACTUEL : Toujours "requested_by_customer" (booking_routes.py:895).
NIVEAU DE CONFIANCE : CERTAIN.
```

### BR-10 — Refund : toujours full refund

```
RÈGLE : Le remboursement est TOUJOURS complet (full refund).
        Le paramètre amount_cents N'EST JAMAIS utilisé dans le code actuel.
SOURCE : booking_routes.py:893–897 — aucun argument amount_cents.
PIÈGE JAVA : Ne pas passer d'amount → Stripe rembourse la totalité de la charge.
NIVEAU DE CONFIANCE : CERTAIN.
```

### BR-11 — Proxy Emergent conditionnel

```
RÈGLE : Si STRIPE_API_KEY contient "sk_test_emergent" → override api_base vers
        "https://integrations.emergentagent.com/stripe".
        Sinon → API Stripe standard (api.stripe.com).
SOURCE : stripe_service.py:39–42.
EN JAVA : Property Spring (stripe.api-base) configurée par profil (dev vs prod).
          Ne PAS hardcoder le check "sk_test_emergent" — utiliser un flag dédié.
NIVEAU DE CONFIANCE : CERTAIN.
```

### BR-12 — Init unique au démarrage

```
RÈGLE : stripe.api_key est configuré UNE SEULE FOIS au démarrage du module.
        Pas de re-configuration par requête.
SOURCE : stripe_service.py:45 — _init_stripe() appelé au module load.
EN JAVA : @PostConstruct dans le @Service ou Stripe.apiKey = ... dans la configuration Spring.
NIVEAU DE CONFIANCE : CERTAIN.
```

### BR-13 — Pas de wrapping async nécessaire en Java

```
RÈGLE : Python utilise asyncio.to_thread() car le SDK Stripe est synchrone
        dans un runtime async (FastAPI).
        Le SDK Stripe Java est AUSSI synchrone — mais Spring MVC est synchrone nativement.
        → Aucun wrapping async nécessaire en Java.
SOURCE : stripe_service.py:48–50 — _run_sync utilise asyncio.to_thread.
PIÈGE : NE PAS envelopper dans CompletableFuture ou @Async sauf si le caller
        est explicitement réactif (WebFlux). Les controllers actuels sont MVC synchrones.
NIVEAU DE CONFIANCE : CERTAIN.
```

---

## Interaction avec le webhook (Slice 16) — Tableau de cohérence

| Action StripeService | Webhook Stripe déclenché | Handler S16 | Cohérence |
|---|---|---|---|
| `capture(pi)` | `payment_intent.succeeded` + `charge.updated` | UPDATE payments → `captured` + store `stripe_charge_id` | ✅ DB déjà `captured` par caller → webhook = no-op (guard `NOT IN ('captured','refunded')`) |
| `cancel(pi)` | `payment_intent.canceled` | UPDATE payments → `cancelled` | ✅ DB déjà `cancelled` par caller → webhook = no-op (guard `NOT IN ('cancelled')`) |
| `refund(ch)` | `charge.refunded` + `refund.updated` | UPDATE payments → `refunded` | ✅ DB déjà `refunded` par caller → webhook = no-op |

**Conclusion** : les webhooks de Slice 16 sont des **filets de sécurité**. Dans le flux nominal, le caller a déjà mis à jour la DB AVANT l'appel Stripe. Le webhook confirme mais ne change rien.

**Cas dégradé** : si l'appel Stripe échoue (BR-02), le webhook ne sera jamais déclenché. La DB reste dans l'état final (ex: `status='cancelled'` en DB mais PI toujours `authorized` côté Stripe). Cet état incohérent nécessite une intervention manuelle ou un worker de réconciliation (hors scope S19).

---

## Asymétries importantes

| Asymétrie | Détail |
|---|---|
| Capture vs Cancel : idempotence Stripe | Cancel un PI déjà cancelled → OK. Capturer un PI déjà captured → StripeException. |
| Refund vs Cancel : paramètre d'entrée | Cancel prend `intent_id` (pi_...). Refund prend `charge_id` (ch_...) — IDs différents. |
| Refund : idempotency_key | Seul refund a une clé d'idempotence. Capture et cancel n'en ont pas. |
| Refund : guard charge_id NULL | Cancel et capture ne vérifient pas si l'ID est null (le caller le fait). Refund a une branche explicite charge_id=NULL → log warning. |
| Cancel : 3 callers vs 1 | Cancel est appelé par 3 flux différents (refuse, cancel, expiry). Capture et refund n'ont qu'un seul caller chacun. |
