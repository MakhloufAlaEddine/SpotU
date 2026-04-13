# SLICE_21_TEST_CASES.md — Cas de tests
> Basé sur `subscription_routes.py:130–449`.
> Référence : `tests/test_subscriptions_iter51.py`.
> Généré le 2026-04-13.

---

## A. GET /subscription-plans

### TC-PL-01 — Liste nominale

```
GIVEN : 2 plans actifs en DB (priority=10 et priority=5)
WHEN  : GET /api/subscription-plans (pas d'auth)
THEN  : 200 + array de 2 plans, ordonnés priority DESC puis price ASC
AND   : chaque plan contient: plan_id, name, description, price, duration_days,
        exempt_payer_fixed, exempt_payer_percent, exempt_receiver_fixed,
        exempt_receiver_percent, active, priority, created_at, updated_at
```

### TC-PL-02 — Plans inactifs exclus

```
GIVEN : 1 plan active=true, 1 plan active=false
WHEN  : GET /api/subscription-plans
THEN  : 200 + array de 1 plan (seulement l'actif)
```

### TC-PL-03 — Aucun plan actif → array vide

```
GIVEN : aucun plan active=true
WHEN  : GET /api/subscription-plans
THEN  : 200 + []
```

### TC-PL-04 — Pas d'auth requise

```
GIVEN : aucun header Authorization
WHEN  : GET /api/subscription-plans
THEN  : 200 (pas de 401)
```

---

## B. POST /subscriptions/subscribe

### TC-SUB-01 — Souscription nominale

```
GIVEN : plan_001 actif, user sans abonnement, sans stripe_customer_id
WHEN  : POST /api/subscriptions/subscribe { plan_id: "plan_001", origin_url: "https://app" }
THEN  : 200 + { url: "https://checkout.stripe.com/...", session_id: "cs_...", plan_id: "plan_001" }
AND   : users.stripe_customer_id mis à jour
AND   : subscription_plans.stripe_product_id et stripe_price_id mis à jour (si premier appel)
```

### TC-SUB-02 — Plan introuvable → 404

```
GIVEN : plan_id "nonexistent"
WHEN  : POST /subscribe { plan_id: "nonexistent" }
THEN  : 404 "Plan introuvable"
```

### TC-SUB-03 — Plan inactif → 400

```
GIVEN : plan_002 active=false
WHEN  : POST /subscribe { plan_id: "plan_002" }
THEN  : 400 "Ce plan n'est plus disponible à la souscription."
```

### TC-SUB-04 — plan_id absent → 400

```
WHEN  : POST /subscribe { }
THEN  : 400 "plan_id requis"
```

### TC-SUB-05 — Abonnement actif existant → 409

```
GIVEN : user a un abonnement status='active'
WHEN  : POST /subscribe { plan_id: "plan_001" }
THEN  : 409 "Vous avez déjà un abonnement active (id=sub_...)"
```

### TC-SUB-06 — Abonnement cancelling → 409

```
GIVEN : user a un abonnement status='cancelling'
WHEN  : POST /subscribe
THEN  : 409 (cancelling bloque aussi)
```

### TC-SUB-07 — Abonnement past_due → autorisé

```
GIVEN : user a un abonnement status='past_due'
WHEN  : POST /subscribe { plan_id: "plan_001" }
THEN  : 200 (past_due ne bloque PAS — BR-01)
```

### TC-SUB-08 — duration_days non supporté → 400

```
GIVEN : plan avec duration_days=90 (ni 30 ni 365)
WHEN  : POST /subscribe
THEN  : 400 "duration_days=90 non supporté"
```

### TC-SUB-09 — Prix ≤ 0 → 400

```
GIVEN : plan avec price=0
WHEN  : POST /subscribe
THEN  : 400 "Le montant du plan doit être supérieur à 0."
```

### TC-SUB-10 — Auth absente → 401

```
WHEN  : POST /subscribe sans header Authorization
THEN  : 401
```

### TC-SUB-11 — Idempotence (même fenêtre 5min)

```
GIVEN : premier appel retourne session_id=cs_001
WHEN  : second appel avec mêmes paramètres dans les 5 minutes
THEN  : Stripe retourne la MÊME session (idempotency key identique)
```

### TC-SUB-12 — stripe_customer_id déjà existant → pas d'UPDATE

```
GIVEN : user avec stripe_customer_id déjà stocké
WHEN  : POST /subscribe
THEN  : UPDATE users WHERE ... AND stripe_customer_id IS NULL → 0 rows
AND   : pas d'erreur
```

---

## C. GET /subscriptions/checkout/status/{session_id}

### TC-CS-01 — Status nominal

```
GIVEN : session cs_test_001 existante, customer match
WHEN  : GET /api/subscriptions/checkout/status/cs_test_001
THEN  : 200 + { session_id, session_status, stripe_sub_id, local_sub_id, local_status, metadata }
```

### TC-CS-02 — Session introuvable → 404

```
WHEN  : GET /checkout/status/cs_nonexistent
THEN  : 404 "Session introuvable"
```

### TC-CS-03 — Customer mismatch → 403

```
GIVEN : session.customer = "cus_other", user.stripe_customer_id = "cus_mine"
WHEN  : GET /checkout/status/cs_test_002
THEN  : 403 "Accès refusé"
```

### TC-CS-04 — Admin bypass ownership

```
GIVEN : session.customer = "cus_other", user.role = "admin"
WHEN  : GET /checkout/status/cs_test_002
THEN  : 200 (admin peut voir toutes les sessions)
```

### TC-CS-05 — Subscription locale pas encore créée (webhook en attente)

```
GIVEN : session complétée mais webhook pas encore traité
WHEN  : GET /checkout/status/cs_test_003
THEN  : 200 + { local_sub_id: null, local_status: null }
```

### TC-CS-06 — Auth absente → 401

```
WHEN  : GET /checkout/status/cs_test sans auth
THEN  : 401
```

---

## D. GET /subscriptions/me

### TC-ME-01 — Abonnement actif

```
GIVEN : user a un abonnement status='active' avec plan Premium
WHEN  : GET /api/subscriptions/me
THEN  : 200 + { has_subscription: true, subscription: { subscription_id, status: "active",
        plan_name: "Premium", benefits_snapshot: { ... }, ... } }
```

### TC-ME-02 — Abonnement cancelling

```
GIVEN : user a un abonnement status='cancelling'
WHEN  : GET /subscriptions/me
THEN  : 200 + { has_subscription: true, subscription: { status: "cancelling", ... } }
```

### TC-ME-03 — Abonnement past_due affiché

```
GIVEN : user a un abonnement status='past_due'
WHEN  : GET /subscriptions/me
THEN  : 200 + { has_subscription: true, subscription: { status: "past_due", ... } }
```

### TC-ME-04 — Aucun abonnement → has_subscription: false

```
GIVEN : user sans abonnement
WHEN  : GET /subscriptions/me
THEN  : 200 + { has_subscription: false, subscription: null }
```

### TC-ME-05 — Abonnement cancelled → non affiché

```
GIVEN : user avec un seul abonnement status='cancelled'
WHEN  : GET /subscriptions/me
THEN  : 200 + { has_subscription: false, subscription: null }
```

### TC-ME-06 — benefits_snapshot désérialisé

```
GIVEN : abonnement avec benefits_snapshot = '{"plan_id":"plan_001","exempt_payer_fixed":true}'
WHEN  : GET /subscriptions/me
THEN  : subscription.benefits_snapshot est un OBJET (pas une string JSON)
```

### TC-ME-07 — Auth absente → 401

```
WHEN  : GET /subscriptions/me sans auth
THEN  : 401
```

---

## E. GET /subscriptions/history

### TC-HI-01 — Historique avec abonnements

```
GIVEN : user avec 3 abonnements (active, cancelled, cancelled)
WHEN  : GET /api/subscriptions/history
THEN  : 200 + array de 3 éléments, ordonnés created_at DESC
AND   : chaque élément contient plan_name et plan_price
```

### TC-HI-02 — Historique vide

```
GIVEN : user sans abonnement
WHEN  : GET /subscriptions/history
THEN  : 200 + []
```

### TC-HI-03 — Auth absente → 401

```
WHEN  : GET /subscriptions/history sans auth
THEN  : 401
```

---

## F. POST /subscriptions/cancel

### TC-CA-01 — Annulation nominale (fin de période)

```
GIVEN : user avec abonnement active, stripe_subscription_id="sub_001"
WHEN  : POST /api/subscriptions/cancel {}
THEN  : 200 + { success: true, subscription_id: "...", status: "cancelling",
        message: "Abonnement annulé à la fin de la période..." }
AND   : Stripe cancel_subscription(at_period_end=true) appelé
AND   : DB: status='cancelling', cancelled_at=NOW()
```

### TC-CA-02 — Annulation immédiate (admin)

```
GIVEN : admin avec abonnement active
WHEN  : POST /cancel { immediate: true }
THEN  : 200 + { status: "cancelled", message: "Abonnement annulé immédiatement." }
AND   : Stripe cancel_subscription(at_period_end=false) appelé
```

### TC-CA-03 — Annulation immédiate par non-admin → 403

```
GIVEN : user normal
WHEN  : POST /cancel { immediate: true }
THEN  : 403 "L'annulation immédiate est réservée aux administrateurs."
```

### TC-CA-04 — Pas d'abonnement actif → 404

```
GIVEN : user sans abonnement actif
WHEN  : POST /cancel
THEN  : 404 "Aucun abonnement actif à annuler"
```

### TC-CA-05 — Body absent → immediate=false (pas d'erreur)

```
WHEN  : POST /cancel (body vide ou Content-Type non-JSON)
THEN  : 200 + status="cancelling" (immediate=false par défaut)
```

### TC-CA-06 — stripe_subscription_id NULL → skip Stripe

```
GIVEN : abonnement SANS stripe_subscription_id (seed/manual)
WHEN  : POST /cancel
THEN  : 200 + DB updated → "cancelling"
AND   : Stripe cancel NON appelé (pas d'erreur)
```

### TC-CA-07 — Stripe cancel échoue → DB mise à jour quand même

```
GIVEN : abonnement avec stripe_subscription_id, mais Stripe réseau down
WHEN  : POST /cancel
THEN  : Stripe cancel échoue → log.error
AND   : DB mise à jour → status="cancelling"
AND   : 200 retourné (pas de 500)
```

### TC-CA-08 — Auth absente → 401

```
WHEN  : POST /cancel sans auth
THEN  : 401
```

---

## Résumé

| Catégorie | Nombre | Couverture |
|---|---|---|
| A. Plans (GET) | 4 | Nominal, inactifs, vide, public |
| B. Subscribe (POST) | 12 | Nominal, 404/400/409, past_due autorisé, idempotence, validation |
| C. Checkout status (GET) | 6 | Nominal, 404, 403, admin bypass, webhook pending, auth |
| D. Me (GET) | 7 | 4 statuts, cancelled exclu, snapshot, auth |
| E. History (GET) | 3 | Nominal, vide, auth |
| F. Cancel (POST) | 8 | Fin période, immédiat, admin, 404, body absent, Stripe skip/down, auth |
| **TOTAL** | **40** | |
