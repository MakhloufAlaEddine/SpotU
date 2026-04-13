# SLICE_22_TEST_CASES.md — Cas de tests
> Basé sur `admin_routes.py:208–283`, `subscription_routes.py:453–511`.
> Généré le 2026-04-13.

---

## A. GET /admin/subscription-plans

### TC-APL-01 — Liste nominale (actifs + inactifs)

```
GIVEN : 2 plans (1 active=true, 1 active=false)
WHEN  : GET /api/admin/subscription-plans (admin auth)
THEN  : 200 + array de 2 plans, incluant stripe_product_id et stripe_price_id
AND   : ordonnés priority DESC, created_at ASC
```

### TC-APL-02 — Non admin → 403

```
GIVEN : user avec role="user"
WHEN  : GET /api/admin/subscription-plans
THEN  : 403
```

### TC-APL-03 — Aucun plan → array vide

```
GIVEN : table vide
WHEN  : GET /api/admin/subscription-plans
THEN  : 200 + []
```

---

## B. POST /admin/subscription-plans (CREATE)

### TC-CRT-01 — Création nominale

```
GIVEN : body { name: "Premium", price: 9.99, duration_days: 30, active: true }
WHEN  : POST /api/admin/subscription-plans (admin auth)
THEN  : 200 + plan complet avec plan_id généré (format plan_...)
AND   : stripe_product_id = null, stripe_price_id = null
```

### TC-CRT-02 — Création minimale (seulement name)

```
GIVEN : body { name: "Basic" }
WHEN  : POST /api/admin/subscription-plans
THEN  : 200 + plan avec price=0, duration_days=null, active=true, priority=0
```

### TC-CRT-03 — name absent → 400

```
GIVEN : body { price: 9.99 }
WHEN  : POST
THEN  : 400 "name is required"
```

### TC-CRT-04 — Non admin → 403

```
GIVEN : user avec role="user"
WHEN  : POST /api/admin/subscription-plans
THEN  : 403
```

### TC-CRT-05 — Exemptions booléennes

```
GIVEN : body { name: "X", exempt_payer_fixed: true, exempt_receiver_percent: true }
WHEN  : POST
THEN  : 200 + exempt_payer_fixed=true, exempt_payer_percent=false,
        exempt_receiver_fixed=false, exempt_receiver_percent=true
```

### TC-CRT-06 — Valeurs par défaut correctes

```
GIVEN : body { name: "X" }
WHEN  : POST
THEN  : price=0.0, active=true, priority=0, tous exempt_*=false
```

---

## C. PUT /admin/subscription-plans/{plan_id} (UPDATE)

### TC-UPD-01 — Update partiel nominal

```
GIVEN : plan_001 existe
WHEN  : PUT /api/admin/subscription-plans/plan_001 { price: 14.99 }
THEN  : 200 + { success: true }
AND   : plan_001.price = 14.99, updated_at mis à jour
```

### TC-UPD-02 — Désactivation plan

```
GIVEN : plan_001 active=true
WHEN  : PUT { active: false }
THEN  : 200 + plan_001.active = false
AND   : GET /subscription-plans (public) ne retourne plus plan_001
```

### TC-UPD-03 — Champs inconnus ignorés

```
GIVEN : body { name: "New", unknown_field: "ignored" }
WHEN  : PUT
THEN  : 200 + name mis à jour, unknown_field silencieusement ignoré
```

### TC-UPD-04 — Body vide (aucun champ valide) → 400

```
GIVEN : body { }
WHEN  : PUT
THEN  : 400 "No valid fields to update"
```

### TC-UPD-05 — Plan introuvable → 404

```
GIVEN : plan_id "nonexistent"
WHEN  : PUT /api/admin/subscription-plans/nonexistent { name: "X" }
THEN  : 404 "Plan not found"
```

### TC-UPD-06 — Non admin → 403

```
WHEN  : PUT (user auth)
THEN  : 403
```

### TC-UPD-07 — stripe_product_id non modifiable

```
GIVEN : body { stripe_product_id: "prod_hack" }
WHEN  : PUT
THEN  : 400 "No valid fields to update" (stripe_* hors du set allowed)
```

### TC-UPD-08 — Update multiple champs

```
GIVEN : body { name: "New", price: 19.99, priority: 20 }
WHEN  : PUT
THEN  : 200 + les 3 champs mis à jour
```

---

## D. DELETE /admin/subscription-plans/{plan_id}

### TC-DEL-01 — Suppression nominale

```
GIVEN : plan_002 sans abonnements liés
WHEN  : DELETE /api/admin/subscription-plans/plan_002
THEN  : 200 + { success: true }
AND   : plan_002 supprimé de la table
```

### TC-DEL-02 — Plan inexistant → success: true (pas de 404)

```
GIVEN : plan_id "nonexistent"
WHEN  : DELETE
THEN  : 200 + { success: true } (DELETE 0 rows, pas d'erreur)
```

### TC-DEL-03 — Plan avec abonnements actifs → FK error

```
GIVEN : plan_001 référencé par user_subscriptions
WHEN  : DELETE /api/admin/subscription-plans/plan_001
THEN  : 500 (ForeignKeyViolationError non catchée en Python)
NOTE  : En Java, catcher → 409 "Plan utilisé par des abonnements"
```

### TC-DEL-04 — Non admin → 403

```
WHEN  : DELETE (user auth)
THEN  : 403
```

---

## E. GET /admin/subscriptions

### TC-ASL-01 — Liste nominale

```
GIVEN : 3 subscriptions (active, cancelled, past_due)
WHEN  : GET /api/admin/subscriptions (admin auth)
THEN  : 200 + array de 3 éléments, ordonnés created_at DESC
AND   : chaque élément inclut user_name, email, plan_name, plan_price
AND   : benefits_snapshot désérialisé (objet, pas string)
```

### TC-ASL-02 — Subscription avec user supprimé → LEFT JOIN

```
GIVEN : subscription dont le user a été supprimé
WHEN  : GET /api/admin/subscriptions
THEN  : 200 + subscription retournée avec user_name=null, email=null
```

### TC-ASL-03 — Subscription avec plan supprimé → LEFT JOIN

```
GIVEN : subscription dont le plan a été supprimé
WHEN  : GET /api/admin/subscriptions
THEN  : 200 + subscription retournée avec plan_name=null, plan_price=null
```

### TC-ASL-04 — LIMIT 500

```
GIVEN : 600 subscriptions en DB
WHEN  : GET /api/admin/subscriptions
THEN  : 200 + array de 500 éléments (les 500 plus récents)
```

### TC-ASL-05 — Non admin → 403

```
WHEN  : GET (user auth)
THEN  : 403
```

### TC-ASL-06 — Aucune subscription → []

```
GIVEN : table vide
WHEN  : GET /api/admin/subscriptions
THEN  : 200 + []
```

---

## F. POST /admin/subscriptions/{subscription_id}/cancel

### TC-ACA-01 — Annulation fin de période (défaut)

```
GIVEN : sub_001 status='active', stripe_subscription_id="sub_stripe_001"
WHEN  : POST /api/admin/subscriptions/sub_001/cancel {}
THEN  : 200 + { success: true, status: "cancelling" }
AND   : Stripe cancel_subscription(at_period_end=true) appelé
AND   : DB status='cancelling', cancelled_at=NOW()
```

### TC-ACA-02 — Annulation immédiate

```
GIVEN : sub_002 status='active'
WHEN  : POST /cancel { immediate: true }
THEN  : 200 + { status: "cancelled" }
AND   : Stripe cancel_subscription(at_period_end=false) appelé
```

### TC-ACA-03 — Subscription introuvable → 404

```
GIVEN : subscription_id "nonexistent"
WHEN  : POST /api/admin/subscriptions/nonexistent/cancel
THEN  : 404 "Abonnement introuvable"
```

### TC-ACA-04 — Subscription déjà cancelled → re-cancel (pas d'erreur)

```
GIVEN : sub_003 status='cancelled'
WHEN  : POST /cancel { immediate: true }
THEN  : 200 + { status: "cancelled" }
AND   : Stripe cancel appelé (peut échouer → log.error)
AND   : DB cancelled_at mis à jour
```

### TC-ACA-05 — Sans stripe_subscription_id → skip Stripe

```
GIVEN : sub_004 sans stripe_subscription_id (seed/manual)
WHEN  : POST /cancel
THEN  : 200 + DB updated
AND   : Stripe cancel NON appelé
```

### TC-ACA-06 — Stripe échoue → DB quand même

```
GIVEN : Stripe réseau down
WHEN  : POST /cancel
THEN  : log.error("Admin cancel Stripe error: ...")
AND   : DB updated → status='cancelling'
AND   : 200 (pas de 500)
```

### TC-ACA-07 — Body absent → immediate=false

```
WHEN  : POST /cancel (body vide ou absent)
THEN  : 200 + status="cancelling"
```

### TC-ACA-08 — Non admin → 403

```
WHEN  : POST (user auth)
THEN  : 403
```

---

## Résumé

| Catégorie | Nombre | Couverture |
|---|---|---|
| A. GET plans admin | 3 | Nominal, 403, vide |
| B. CREATE plan | 6 | Nominal, minimal, 400, 403, exemptions, défauts |
| C. UPDATE plan | 8 | Partiel, désactivation, ignoré, vide, 404, 403, stripe exclus, multiple |
| D. DELETE plan | 4 | Nominal, inexistant, FK error, 403 |
| E. GET subscriptions | 6 | Nominal, LEFT JOIN user/plan, LIMIT, 403, vide |
| F. Admin cancel | 8 | Fin période, immédiat, 404, déjà cancelled, skip Stripe, Stripe down, body, 403 |
| **TOTAL** | **35** | |
