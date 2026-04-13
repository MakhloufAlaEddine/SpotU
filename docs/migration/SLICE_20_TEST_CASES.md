# SLICE_20_TEST_CASES.md — Cas de tests
> Basé sur `webhook_handlers.py:584–935`.
> Référence : `tests/test_subscriptions_iter51.py`, `tests/test_webhooks_iter52.py`.
> Généré le 2026-04-13.

---

## A. checkout.session.completed (mode=subscription)

### TC-CS-01 — Activation nominale

```
GIVEN : payload checkout.session.completed avec mode=subscription,
        metadata: {plan_id: "plan_001", user_id: "usr_001"},
        subscription: "sub_stripe_001"
AND   : plan_001 existe dans subscription_plans (active=true)
AND   : aucune entrée user_subscriptions avec stripe_subscription_id="sub_stripe_001"
WHEN  : webhook dispatch
THEN  : INSERT user_subscriptions avec status='active', started_at=NOW()
AND   : benefits_snapshot contient les exemptions du plan
AND   : notification subscription_activated envoyée à usr_001
AND   : stripe_webhook_events marqué success
```

### TC-CS-02 — Idempotence (subscription déjà enregistrée)

```
GIVEN : payload identique à TC-CS-01
AND   : user_subscriptions contient déjà stripe_subscription_id="sub_stripe_001"
WHEN  : webhook dispatch
THEN  : PAS d'INSERT (log.debug, skip)
AND   : PAS de notification
AND   : stripe_webhook_events marqué success
```

### TC-CS-03 — Plan introuvable

```
GIVEN : payload avec plan_id: "plan_nonexistent"
WHEN  : webhook dispatch
THEN  : PAS d'INSERT (log.warning "Plan introuvable")
AND   : PAS de notification
AND   : stripe_webhook_events marqué success (pas error)
```

### TC-CS-04 — Metadata incomplète (plan_id absent)

```
GIVEN : payload avec metadata: {user_id: "usr_001"} (pas de plan_id)
WHEN  : webhook dispatch
THEN  : log.warning "données incomplètes"
AND   : PAS d'INSERT, PAS de notification
```

### TC-CS-05 — Metadata incomplète (user_id absent)

```
GIVEN : payload avec metadata: {plan_id: "plan_001"} (pas de user_id)
WHEN  : webhook dispatch
THEN  : log.warning + return
```

### TC-CS-06 — Mode=payment (pas subscription)

```
GIVEN : payload checkout.session.completed avec mode=payment
WHEN  : _dispatch_subscription appelé
THEN  : return None (pas traité — géré par _handle_payment_event)
```

### TC-CS-07 — retrieve_subscription échoue → expires_at=NULL

```
GIVEN : payload valide mais Stripe réseau down
WHEN  : webhook dispatch
THEN  : INSERT avec expires_at=NULL (log.warning)
AND   : notification quand même envoyée
```

### TC-CS-08 — benefits_snapshot correct

```
GIVEN : plan avec exempt_payer_fixed=true, exempt_receiver_percent=true
WHEN  : webhook checkout.session.completed
THEN  : benefits_snapshot JSONB contient:
        {"plan_id": "plan_001", "plan_name": "Premium",
         "exempt_payer_fixed": true, "exempt_payer_percent": false,
         "exempt_receiver_fixed": false, "exempt_receiver_percent": true,
         "snapshotted_at": "2026-..."}
```

---

## B. customer.subscription.created

### TC-SC-01 — Création nominale (fallback)

```
GIVEN : payload subscription.created avec id="sub_002",
        metadata: {plan_id, user_id}, current_period_end=1234567890
AND   : PAS d'entrée avec stripe_subscription_id="sub_002"
WHEN  : webhook dispatch
THEN  : INSERT user_subscriptions status='active'
AND   : expires_at calculé depuis current_period_end
AND   : notification subscription_activated
```

### TC-SC-02 — Déjà traité par checkout (idempotence)

```
GIVEN : stripe_subscription_id="sub_002" existe déjà
WHEN  : webhook subscription.created
THEN  : return (skip, pas de doublon)
```

### TC-SC-03 — Pas de metadata (souscription Dashboard)

```
GIVEN : payload sans plan_id ET sans user_id dans metadata
WHEN  : webhook dispatch
THEN  : return silencieux (pas de log.warning)
```

---

## C. customer.subscription.updated

### TC-SU-01 — Active + cancel_at_period_end=true → cancelling

```
GIVEN : user_subscriptions status='active', stripe_subscription_id="sub_003"
AND   : payload: status="active", cancel_at_period_end=true, current_period_end=...
WHEN  : webhook dispatch
THEN  : UPDATE status='cancelling', expires_at mis à jour
AND   : notification subscription_cancelling
```

### TC-SU-02 — Active + cancel_at_period_end=false → active (no-op)

```
GIVEN : user_subscriptions status='active'
AND   : payload: status="active", cancel_at_period_end=false
WHEN  : webhook dispatch
THEN  : UPDATE status='active' (pas de changement réel)
AND   : rows_updated=0 → PAS de notification (guard _rows)
```

### TC-SU-03 — Status="canceled" → cancelled

```
GIVEN : user_subscriptions status='cancelling'
AND   : payload: status="canceled"
WHEN  : webhook dispatch
THEN  : UPDATE status='cancelled'
AND   : notification subscription_cancelled
```

### TC-SU-04 — Status="cancelled" (UK spelling) → cancelled

```
GIVEN : payload: status="cancelled" (variante orthographique)
WHEN  : webhook dispatch
THEN  : UPDATE status='cancelled' (les deux orthographes acceptées)
```

### TC-SU-05 — Status="past_due" → past_due

```
GIVEN : user_subscriptions status='active'
AND   : payload: status="past_due"
WHEN  : webhook dispatch
THEN  : UPDATE status='past_due'
AND   : PAS de notification (subscription.updated ne notifie que cancelling/cancelled)
```

### TC-SU-06 — Guard : subscription déjà cancelled → pas de mise à jour

```
GIVEN : user_subscriptions status='cancelled'
AND   : payload: status="active", cancel_at_period_end=false
WHEN  : webhook dispatch
THEN  : UPDATE WHERE status NOT IN ('cancelled') → 0 rows
AND   : PAS de notification
```

### TC-SU-07 — Sans expires_at (current_period_end absent)

```
GIVEN : payload SANS current_period_end
WHEN  : webhook dispatch
THEN  : SQL UPDATE sans SET expires_at (branche else)
AND   : expires_at inchangé en DB
```

### TC-SU-08 — Subscription inconnue (pas en DB)

```
GIVEN : stripe_subscription_id="sub_unknown" pas en DB
WHEN  : webhook subscription.updated
THEN  : UPDATE WHERE stripe_subscription_id='sub_unknown' → 0 rows
AND   : PAS de notification (rows_updated=0)
AND   : PAS d'erreur (success silencieux)
```

---

## D. customer.subscription.deleted

### TC-SD-01 — Suppression nominale

```
GIVEN : user_subscriptions status='active', stripe_subscription_id="sub_004"
WHEN  : webhook subscription.deleted
THEN  : UPDATE status='cancelled', cancelled_at=NOW()
AND   : notification subscription_cancelled (titre "Abonnement résilié")
```

### TC-SD-02 — Suppression d'un abonnement déjà cancelled → idempotent

```
GIVEN : user_subscriptions status='cancelled' (déjà annulé)
WHEN  : webhook subscription.deleted
THEN  : UPDATE exécuté QUAND MÊME (pas de guard NOT IN)
AND   : cancelled_at mis à jour
AND   : notification SI rows_updated > 0 (dépend du status avant/après)
```

### TC-SD-03 — Subscription inconnue

```
GIVEN : stripe_subscription_id="sub_unknown"
WHEN  : webhook subscription.deleted
THEN  : UPDATE → 0 rows (user_id=None)
AND   : PAS de notification
```

---

## E. invoice.paid

### TC-IP-01 — Renouvellement nominal

```
GIVEN : user_subscriptions status='active', stripe_subscription_id="sub_005"
AND   : payload: subscription="sub_005", lines.data[0].period.end=1234567890
WHEN  : webhook invoice.paid
THEN  : UPDATE expires_at, status='active'
AND   : notification subscription_renewed
```

### TC-IP-02 — Renouvellement depuis past_due → active

```
GIVEN : user_subscriptions status='past_due'
WHEN  : webhook invoice.paid avec period.end valide
THEN  : UPDATE status='active' (retour à active)
AND   : notification subscription_renewed
```

### TC-IP-03 — Renouvellement depuis cancelling → active

```
GIVEN : user_subscriptions status='cancelling'
WHEN  : webhook invoice.paid
THEN  : UPDATE status='active' (BR-07 : force active)
AND   : notification subscription_renewed
```

### TC-IP-04 — Guard : cancelled → pas de mise à jour

```
GIVEN : user_subscriptions status='cancelled'
WHEN  : webhook invoice.paid
THEN  : UPDATE WHERE status NOT IN ('cancelled') → 0 rows
AND   : PAS de notification
```

### TC-IP-05 — Invoice sans subscription → ignoré

```
GIVEN : payload invoice.paid SANS champ subscription
WHEN  : webhook dispatch
THEN  : return (early exit)
```

### TC-IP-06 — Invoice sans period_end → log warning

```
GIVEN : payload avec subscription="sub_005" mais lines.data vide
WHEN  : webhook dispatch
THEN  : log.warning "pas de period_end trouvé"
AND   : PAS d'UPDATE
```

---

## F. invoice.payment_failed

### TC-IF-01 — Passage en past_due nominal

```
GIVEN : user_subscriptions status='active', stripe_subscription_id="sub_006"
WHEN  : webhook invoice.payment_failed
THEN  : UPDATE status='past_due'
AND   : notification subscription_payment_failed
```

### TC-IF-02 — Déjà past_due → no-op

```
GIVEN : user_subscriptions status='past_due'
WHEN  : webhook invoice.payment_failed
THEN  : UPDATE status='past_due' → 0 rows (pas de changement)
AND   : PAS de notification (rows_updated=0)
```

### TC-IF-03 — Guard : cancelled → pas de mise à jour

```
GIVEN : user_subscriptions status='cancelled'
WHEN  : webhook invoice.payment_failed
THEN  : 0 rows
AND   : PAS de notification
```

### TC-IF-04 — Invoice sans subscription → ignoré

```
GIVEN : payload sans champ subscription
WHEN  : webhook dispatch
THEN  : return (early exit)
```

---

## G. Dispatch et idempotence globale

### TC-DI-01 — Event_id déjà traité → skip

```
GIVEN : event_id="evt_duplicate" déjà dans stripe_webhook_events
WHEN  : webhook dispatch
THEN  : _claim_event retourne false
AND   : retour {"received": true, "idempotent_skip": true}
AND   : AUCUN handler appelé
```

### TC-DI-02 — related_id résolu après traitement

```
GIVEN : webhook subscription.created crée sub_local_007
WHEN  : dispatch se termine
THEN  : stripe_webhook_events.related_id = "sub_local_007"
```

### TC-DI-03 — Erreur dans handler → marqué error, HTTP 200

```
GIVEN : handler lève une exception inattendue
WHEN  : dispatch
THEN  : _mark_done(status='error', error_message=str(exc)[:500])
AND   : retour {"received": true} (HTTP 200 — pas d'erreur pour Stripe)
```

### TC-DI-04 — Notifications envoyées APRÈS libération connexion

```
GIVEN : handler ajoute 2 notifications à pending_notifs
WHEN  : dispatch
THEN  : notifications envoyées APRÈS le bloc async with pool.acquire
AND   : si une notification échoue → log.warning (pas d'exception)
```

---

## Résumé des cas de test

| Catégorie | Nombre | Couverture |
|---|---|---|
| A. checkout.session.completed | 8 | Nominal, idempotence, plan absent, metadata, mode, Stripe down, snapshot |
| B. subscription.created | 3 | Nominal, idempotence, Dashboard |
| C. subscription.updated | 8 | 5 statuts, guard cancelled, sans expires, inconnue |
| D. subscription.deleted | 3 | Nominal, déjà cancelled, inconnue |
| E. invoice.paid | 6 | Renouvellement, past_due→active, cancelling→active, guard, sans sub, sans period |
| F. invoice.payment_failed | 4 | Nominal, déjà past_due, guard, sans sub |
| G. Dispatch/idempotence | 4 | Doublon, related_id, erreur, notifications |
| **TOTAL** | **36** | |
