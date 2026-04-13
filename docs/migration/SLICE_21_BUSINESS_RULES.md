# SLICE_21_BUSINESS_RULES.md — Règles métier
> Basé sur `subscription_routes.py:130–449`.
> Généré le 2026-04-13.

---

## BR-01 — Un seul abonnement actif par utilisateur

```
RÈGLE : POST /subscribe vérifie qu'aucune entrée user_subscriptions n'existe
        avec user_id courant ET status IN ('active', 'cancelling', 'trialing').
        Si une existe → 409 avec message incluant le subscription_id et le status.
SOURCE : subscription_routes.py:260–273.
PIÈGE : Le filtre N'inclut PAS 'past_due'. Un utilisateur en past_due PEUT
        créer une nouvelle souscription (intentionnel — le paiement a échoué).
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-02 — Plan doit être actif pour souscrire

```
RÈGLE : Le plan est chargé par plan_id (SELECT * sans filtre active).
        Si active=false → 400 (pas 404) : "Ce plan n'est plus disponible".
SOURCE : subscription_routes.py:252–257.
ASYMÉTRIE : Le SELECT charge le plan SANS filtre active (pour donner
            un message d'erreur clair). L'endpoint public GET /subscription-plans
            filtre par active=TRUE.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-03 — `_get_or_create_stripe_price` idempotent + cache DB

```
RÈGLE : Si le plan a déjà un stripe_price_id en DB, il est retourné directement
        (pas d'appel Stripe). Sinon, ensure_subscription_price() crée les objets
        Stripe ET met à jour la DB.
SOURCE : subscription_routes.py:70–71 (early return si stripe_price_id existe),
         93–108 (Stripe + UPDATE).
IMPLICATION : Le premier abonné à un plan déclenche la création Stripe.
              Les suivants réutilisent le cache DB.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-04 — duration_days validé AVANT l'appel Stripe

```
RÈGLE : Seules les valeurs 30 (mensuel) et 365 (annuel) sont supportées.
        La validation est faite via _duration_to_interval() AVANT tout appel Stripe.
        Toute autre valeur → 400.
SOURCE : subscription_routes.py:74–84, stripe_service.py:359–371.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-05 — Customer Stripe créé/réutilisé par metadata

```
RÈGLE : get_or_create_customer() cherche un Customer Stripe par metadata user_id.
        Si trouvé → réutilise. Sinon → crée. Le customer_id est stocké dans
        users.stripe_customer_id (UPDATE WHERE ... IS NULL pour ne pas écraser).
SOURCE : stripe_service.py:55–77, subscription_routes.py:279–290.
PIÈGE : L'UPDATE est conditionnel (IS NULL). Si stripe_customer_id est déjà
        stocké, la ligne n'est pas modifiée.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-06 — Idempotency key avec fenêtre temporelle

```
RÈGLE : La clé d'idempotence de la Checkout Session est composée de :
        user_id + plan_id + bucket_5min (int(time.time() // 300))
        Préfixée par "sub_cs_" dans stripe_service.
        Résultat : "sub_cs_{user_id}_{plan_id}_{bucket}"
SOURCE : subscription_routes.py:301–310, stripe_service.py:339.
IMPLICATION : Dans une fenêtre de 5 minutes, un double appel retourne
              la MÊME session Stripe (pas de doublon). Après 5 minutes,
              une nouvelle session est créée (utile si la précédente a expiré).
PIÈGE JAVA : Reproduire exactement la formule (System.currentTimeMillis()/1000/300).
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-07 — Checkout URLs utilisent le placeholder Stripe

```
RÈGLE : success_url contient {CHECKOUT_SESSION_ID} (placeholder Stripe littéral).
        Stripe remplace ce placeholder par le vrai session_id lors de la redirection.
SOURCE : subscription_routes.py:293.
PIÈGE : En Java, les accolades {} doivent être échappées ou traitées comme littéral.
        NE PAS interpoler côté Java.
DÉJÀ DOCUMENTÉ : S17 (même pattern pour payment checkout).
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-08 — Cancel : immediate réservé aux admins

```
RÈGLE : Le body est optionnel. Si absent ou invalide → immediate=false.
        immediate=true → 403 si user.role != "admin".
        immediate=true → Stripe cancel immédiat + status="cancelled"
        immediate=false (défaut) → Stripe cancel_at_period_end=true + status="cancelling"
SOURCE : subscription_routes.py:339–351, 367–375.
PIÈGE : Ce même endpoint est utilisé par les users normaux ET les admins.
        Le contrôle admin est sur le flag immediate, PAS sur l'endpoint.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-09 — Cancel : Stripe AVANT DB (ordre inversé)

```
RÈGLE : L'annulation Stripe est exécutée AVANT la mise à jour DB.
        Ordre : SELECT → Stripe cancel → DB UPDATE
        C'est l'INVERSE de booking cancel (S15) où DB est AVANT Stripe.
SOURCE : subscription_routes.py:370–390.
RAISON PROBABLE : Si Stripe échoue, la DB reste inchangée (abonnement toujours actif).
        Le webhook subscription.updated arrivera et mettra à jour la DB.
RISQUE : Si Stripe réussit MAIS la DB échoue → état incohérent temporaire.
        Le webhook rattrapera.
NIVEAU DE CONFIANCE : CERTAIN (code explicite).
```

## BR-10 — Cancel : stripe_subscription_id peut être NULL

```
RÈGLE : Si stripe_subscription_id est NULL (abonnement créé manuellement/seed),
        l'appel Stripe est sauté (guard: if sub.get("stripe_subscription_id")).
        La DB est mise à jour quand même.
SOURCE : subscription_routes.py:370.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-11 — Checkout/status : ownership par customer_id

```
RÈGLE : L'endpoint vérifie que session.customer correspond au stripe_customer_id
        de l'utilisateur connecté. Si mismatch → 403 (sauf admin).
SOURCE : subscription_routes.py:419–426.
PIÈGE : Si customer_id est NULL en DB (user n'a jamais souscrit), le check est
        passé (condition: `if customer_id and session.customer != customer_id`).
        Un user sans customer_id peut voir N'IMPORTE QUELLE session.
        C'est un comportement du code Python actuel.
NIVEAU DE CONFIANCE : CERTAIN (code explicite). RECOMMANDATION : ajouter
        une vérification plus stricte en Java.
```

## BR-12 — /me retourne has_subscription: false (pas 404)

```
RÈGLE : Si aucun abonnement actif n'est trouvé, la réponse est 200 avec
        { has_subscription: false, subscription: null } — PAS une 404.
SOURCE : subscription_routes.py:192–193.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-13 — /me inclut past_due, /subscribe ne l'inclut pas

```
RÈGLE : /me affiche l'abonnement même si past_due (le user doit voir son état).
        /subscribe NE bloque PAS un user en past_due (il peut re-souscrire).
        /cancel NE liste PAS les past_due (on ne peut pas annuler un abonnement en échec).
SOURCE : /me → status IN ('active','cancelling','past_due','trialing')
         /subscribe guard → status IN ('active','cancelling','trialing')
         /cancel → status IN ('active','cancelling','trialing')
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-14 — benefits_snapshot désérialisé en réponse

```
RÈGLE : benefits_snapshot est stocké comme JSONB mais peut avoir été sérialisé
        en string (legacy). Le helper _sub_to_dict détecte et parse si string.
SOURCE : subscription_routes.py:54–56.
EN JAVA : Si le champ est déjà un Map via JPA converter, pas de parse nécessaire.
          Si stocké comme String → ObjectMapper.readValue().
NIVEAU DE CONFIANCE : CERTAIN.
```

---

## Interaction avec S20 (webhooks)

| Action S21 | Event S20 déclenché | Effet |
|---|---|---|
| `POST /subscribe` → checkout → user paie | `checkout.session.completed` | INSERT user_subscriptions (active) |
| `POST /cancel` (at_period_end) | `customer.subscription.updated` | UPDATE status='cancelling' |
| `POST /cancel` (immediate) | `customer.subscription.deleted` | UPDATE status='cancelled' |

**Flux complet** :
```
S21: POST /subscribe → Stripe Checkout
  → Stripe: checkout.session.completed
    → S20: INSERT user_subscriptions (active)
S21: GET /subscriptions/me → reads user_subscriptions (created by S20)
S21: POST /subscriptions/cancel → Stripe cancel
  → Stripe: subscription.updated / deleted
    → S20: UPDATE user_subscriptions (cancelling / cancelled)
```
