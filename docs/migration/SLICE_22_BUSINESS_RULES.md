# SLICE_22_BUSINESS_RULES.md — Règles métier
> Basé sur `admin_routes.py:208–283`, `subscription_routes.py:453–511`.
> Généré le 2026-04-13.

---

## BR-01 — Tous les endpoints admin exigent role="admin"

```
RÈGLE : Les 6 endpoints utilisent require_role(request, pool, "admin").
        Un utilisateur non-admin reçoit 403.
SOURCE : admin_routes.py:213,224,255,280 — subscription_routes.py:155,457,476.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-02 — CREATE plan : seul `name` est requis

```
RÈGLE : Le seul champ obligatoire pour créer un plan est `name`.
        Tous les autres ont des défauts : price=0, active=true, priority=0,
        exempt_*=false, duration_days=null, description=null.
SOURCE : admin_routes.py:226–247.
PIÈGE : Un plan créé avec price=0 et duration_days=null est techniquement valide
        en DB, mais échouera au moment du subscribe (S21 valide price>0 et duration_days).
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-03 — CREATE plan : pas de validation métier

```
RÈGLE : Le POST ne valide PAS :
        - price > 0 (accepte 0 et négatifs via float())
        - duration_days IN (30, 365) (accepte n'importe quelle valeur)
        - unicité du name
        - cohérence des exemptions
SOURCE : admin_routes.py:226–248 — aucun guard sauf "name in body".
IMPLICATION : La validation est reportée au moment du subscribe (S21).
EN JAVA : Reproduire le même comportement (pas de validation au CREATE)
          OU ajouter des validations supplémentaires (recommandé mais hors scope compat).
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-04 — UPDATE plan : champs dynamiques avec set `allowed`

```
RÈGLE : Le PUT accepte un body partiel. Seuls les champs dans `allowed` sont traités.
        Les champs inconnus sont SILENCIEUSEMENT IGNORÉS (pas d'erreur).
        Si AUCUN champ valide n'est fourni → 400.
SOURCE : admin_routes.py:257–266.
SET ALLOWED : name, description, price, duration_days,
              exempt_payer_fixed, exempt_payer_percent,
              exempt_receiver_fixed, exempt_receiver_percent,
              active, priority
EXCLUS : plan_id, created_at, updated_at, stripe_product_id, stripe_price_id
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-05 — UPDATE plan : pas de mise à jour Stripe

```
RÈGLE : Modifier price ou duration_days via PUT ne met PAS à jour les objets
        Stripe (Product/Price). Le cache Stripe en DB (stripe_price_id) devient
        potentiellement incohérent.
SOURCE : admin_routes.py:267–270 — UPDATE SQL simple sans appel Stripe.
IMPLICATION : Au prochain subscribe, _get_or_create_stripe_price (S21) vérifiera
              le stripe_price_id existant et le retournera directement — SANS vérifier
              si le montant Stripe correspond au nouveau prix DB.
RISQUE : Si admin change le prix du plan, les NOUVEAUX abonnés paieront l'ANCIEN prix
         Stripe (celui du Price existant). Pour corriger : supprimer stripe_price_id
         dans subscription_plans, forçant la recréation d'un nouveau Price Stripe.
NIVEAU DE CONFIANCE : CERTAIN (comportement code) — INCERTITUDE : est-ce intentionnel ?
```

## BR-06 — DELETE plan : suppression physique sans guard

```
RÈGLE : DELETE FROM subscription_plans WHERE plan_id=$1 — suppression définitive.
        Pas de soft delete. Pas de vérification d'abonnements actifs.
SOURCE : admin_routes.py:281–282.
RISQUE FK : user_subscriptions.plan_id → subscription_plans.plan_id (FOREIGN KEY,
            pas de ON DELETE CASCADE). PostgreSQL lèvera ForeignKeyViolationError
            si des subscriptions référencent ce plan → HTTP 500 (non catchée).
RECOMMANDATION JAVA : Catch DataIntegrityViolationException → 409.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-07 — DELETE plan : toujours success=true

```
RÈGLE : Si le plan n'existe pas, DELETE 0 rows mais le code retourne
        quand même {"success": true} (pas de check sur le résultat).
SOURCE : admin_routes.py:282–283.
ASYMÉTRIE : PUT retourne 404 si UPDATE 0 rows. DELETE ne le fait pas.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-08 — GET plans admin : SELECT * (inclut stripe_*)

```
RÈGLE : L'endpoint admin retourne TOUTES les colonnes (SELECT *),
        incluant stripe_product_id et stripe_price_id.
        L'endpoint public (S21) les masque.
SOURCE : admin_routes.py:216 vs subscription_routes.py:139–147 (S21).
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-09 — Admin cancel : lookup par subscription_id (pas user_id)

```
RÈGLE : L'admin annule par subscription_id direct.
        SELECT * FROM user_subscriptions WHERE subscription_id=$1
        Pas de filtre sur status — l'admin peut "annuler" un abonnement déjà annulé.
SOURCE : subscription_routes.py:484–488.
DIFFÉRENCE S21 : User cancel cherche par user_id + status IN (...).
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-10 — Admin cancel : ordre Stripe → DB (identique à S21)

```
RÈGLE : Comme le cancel utilisateur (S21), l'annulation Stripe est exécutée
        AVANT la mise à jour DB. Erreur Stripe → log.error, DB mise à jour quand même.
SOURCE : subscription_routes.py:495–509.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-11 — Admin cancel : réponse réduite

```
RÈGLE : La réponse admin est minimaliste : {success: true, status: "cancelling"}.
        PAS de subscription_id ni de message dans la réponse (contrairement à S21 user).
SOURCE : subscription_routes.py:511.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-12 — GET subscriptions : LEFT JOIN + LIMIT 500

```
RÈGLE : Les subscriptions sont enrichies via LEFT JOIN (pas INNER).
        Si un user ou plan a été supprimé, la subscription apparaît quand même
        avec user_name=null et plan_name=null.
        LIMIT 500 protège contre les réponses trop volumineuses.
SOURCE : subscription_routes.py:459–468.
PIÈGE JAVA : Ne pas utiliser INNER JOIN — un plan DELETE'd rendrait les subscriptions liées invisibles.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-13 — Duplication GET plans : handler effectif = admin_routes.py

```
RÈGLE : GET /api/admin/subscription-plans est défini DEUX FOIS :
        - admin_routes.py:210 (monté à /admin prefix → /api/admin/subscription-plans)
        - subscription_routes.py:151 (monté sans prefix → /api/admin/subscription-plans)
        FastAPI enregistre admin_routes en premier (server.py:102 vs 107).
        Le handler d'admin_routes.py est probablement celui appelé.
SOURCE : server.py:102,107.
EN JAVA : N'implémenter QU'UN SEUL endpoint. Utiliser le comportement admin_routes.py
          (rows_to_list, ORDER BY ... created_at ASC).
INCERTITUDE : FAIBLE — le comportement FastAPI pour les routes dupliquées dépend
              de l'ordre d'enregistrement.
```

---

## Interaction avec les Slices précédentes

| Action S22 | Impact S19–S21 |
|---|---|
| CREATE plan | Crée un plan que S21 POST /subscribe peut utiliser |
| UPDATE plan (active=false) | S21 GET /subscription-plans ne le retourne plus (filtre active=TRUE) |
| UPDATE plan (price) | S21 subscribe utilise le cache Stripe — prix potentiellement incohérent (BR-05) |
| DELETE plan | S21 subscribe → 404 "Plan introuvable". S20 webhook → log warning plan absent |
| Admin cancel | S20 webhook subscription.updated/deleted confirme l'annulation |
