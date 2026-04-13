# SLICE_20_BUSINESS_RULES.md — Règles métier
> Basé sur `webhook_handlers.py:584–935`, `subscription_routes.py:516–744`.
> Généré le 2026-04-13.

---

## BR-01 — Source de vérité unique

```
RÈGLE : TOUTES les transitions d'état d'abonnement en DB proviennent des webhooks Stripe.
        Aucun endpoint utilisateur ne crée directement un enregistrement user_subscriptions.
        Le flow est : user → POST /subscribe → Stripe Checkout → webhook → INSERT DB.
SOURCE : webhook_handlers.py:584 (_handle_subscription_event est le seul writer actif).
EXCEPTION : subscription_routes.py:handle_subscription_event() contient une copie legacy
            qui n'est PAS appelée en production. NE PAS MIGRER.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-02 — Un seul abonnement actif par utilisateur

```
RÈGLE : Un utilisateur ne peut avoir qu'un seul abonnement avec status IN
        ('active', 'cancelling', 'trialing') à la fois.
        Cette contrainte est vérifiée CÔTÉ ENDPOINT (POST /subscribe vérifie
        avant de créer la Checkout Session), pas côté webhook.
SOURCE : subscription_routes.py:260–273 (guard côté subscribe endpoint).
IMPLICATION WEBHOOK : Le webhook n'a PAS de garde anti-doublon par user.
        Il vérifie uniquement par stripe_subscription_id (idempotence Stripe).
        Si Stripe crée 2 subscriptions pour le même user (edge case Dashboard),
        2 enregistrements seront créés en DB.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-03 — Idempotence INSERT par stripe_subscription_id

```
RÈGLE : Avant chaque INSERT (events 1 et 2), le handler vérifie :
        SELECT subscription_id FROM user_subscriptions WHERE stripe_subscription_id=$1
        Si une ligne existe → skip silencieux (log.debug ou log.info).
SOURCE : webhook_handlers.py:652–661 (event 1), 720–725 (event 2).
PIÈGE : Ce n'est PAS un ON CONFLICT. C'est un SELECT + branch en application.
        En Java : vérifier avant INSERT. OU utiliser un UNIQUE INDEX sur
        stripe_subscription_id (recommandé pour la robustesse).
NOTE : Il n'y a PAS d'index UNIQUE sur stripe_subscription_id dans le schéma actuel.
       L'idempotence repose sur le code applicatif uniquement.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-04 — Dual routing checkout.session.completed

```
RÈGLE : L'event checkout.session.completed est dans DEUX sets :
        _PAYMENT_EVENTS ET _SUBSCRIPTION_EVENTS.
        Le dispatcher appelle LES DEUX handlers.
        Le discriminant est obj.mode :
        - "payment"      → _handle_payment_event traite, _handle_subscription_event retourne
        - "subscription"  → _handle_payment_event retourne, _handle_subscription_event traite
SOURCE : webhook_handlers.py:207–208 (payment: if mode=="subscription": return),
         webhook_handlers.py:636–637 (subscription: if mode!="subscription": return).
PIÈGE JAVA : Si vous utilisez un routeur if/else par event_type, un seul handler
             sera appelé. Le pattern Python appelle les DEUX et chacun filtre par mode.
             En Java : implémenter le même double-dispatch OU router par (event_type, mode).
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-05 — Mapping statut Stripe → statut interne (subscription.updated)

```
RÈGLE : Le mapping dépend de DEUX champs : stripe_status ET cancel_at_period_end.
        - active + cancel_at_period_end=true  → "cancelling"
        - active + cancel_at_period_end=false → "active"
        - "canceled" ou "cancelled"           → "cancelled"
        - "past_due"                          → "past_due"
        - "trialing"                          → "trialing"
        - Toute autre valeur                  → passthrough (valeur brute)
SOURCE : webhook_handlers.py:772–783.
PIÈGE : Stripe envoie "canceled" (US spelling). Python accepte aussi "cancelled" (UK).
        En Java : tester les DEUX orthographes.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-06 — Guard NOT IN ('cancelled') sur UPDATE

```
RÈGLE : Les events 3 (updated), 5 (invoice.paid), 6 (invoice.payment_failed)
        utilisent un guard : WHERE status NOT IN ('cancelled').
        Un abonnement annulé ne peut PAS être réactivé par un webhook.
EXCEPTION : Event 4 (subscription.deleted) n'a PAS de guard.
            Il force status='cancelled' inconditionnellement.
SOURCE : webhook_handlers.py:791 (event 3), 885 (event 5), 919 (event 6),
         webhook_handlers.py:839 (event 4 — SANS guard).
ASYMÉTRIE : deleted est le seul event sans guard car c'est l'état terminal Stripe.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-07 — invoice.paid force status='active'

```
RÈGLE : L'event invoice.paid met à jour DEUX colonnes : expires_at ET status='active'.
        Cela signifie qu'un abonnement en statut 'cancelling' ou 'past_due'
        peut redevenir 'active' si un paiement réussit.
SOURCE : webhook_handlers.py:883 — SET expires_at=$1, status='active'.
IMPLICATION : Si l'utilisateur a annulé (cancelling) mais Stripe a déjà facturé
              avant la fin de période → invoice.paid arrive → status redevient 'active'.
              C'est le comportement attendu : le prochain subscription.updated
              remettra cancel_at_period_end=true → 'cancelling'.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-08 — benefits_snapshot figé à l'activation

```
RÈGLE : Le benefits_snapshot est calculé et stocké UNIQUEMENT à l'INSERT (events 1 et 2).
        Il N'EST JAMAIS mis à jour par les events suivants (updated, invoice, deleted).
        Si l'admin change les exemptions du plan après activation, l'abonnement
        existant conserve les exemptions ORIGINALES.
SOURCE : webhook_handlers.py:671 (event 1), 734 (event 2) — seuls endroits d'INSERT.
         Aucun UPDATE ne touche benefits_snapshot.
IMPLICATION : Le pricing_engine utilise _load_subscription_benefits() qui lit
              benefits_snapshot (JSONB) — pas les champs plan courants.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-09 — Appel Stripe réseau DANS le handler (checkout event seulement)

```
RÈGLE : L'event checkout.session.completed fait un appel Stripe RÉSEAU
        pour récupérer current_period_end (pas disponible dans le payload checkout).
        Cet appel est DANS la connexion DB (pas hors transaction comme S19).
SOURCE : webhook_handlers.py:674–679.
RISQUE : Si Stripe est lent, la connexion DB est bloquée pendant l'appel.
         Le try/except protège : si l'appel échoue, expires_at=None.
PIÈGE JAVA : En Java, cet appel devrait idéalement être hors transaction
             pour ne pas tenir le lock DB. Mais le code Python le fait DANS.
             Choix : reproduire le comportement Python (simple) ou refactorer (mieux).
INCERTITUDE : FAIBLE — le risque est réel mais acceptable car checkout est un event rare (1x par souscription).
```

## BR-10 — Notifications conditionnelles sur rows_updated > 0

```
RÈGLE : Les notifications ne sont émises que si l'UPDATE DB a réellement modifié
        au moins une ligne (_rows(res) > 0).
        Cela évite les notifications en double si le webhook est reçu 2x
        (l'idempotence _claim_event bloque les doublons exacts, mais
         Stripe peut envoyer subscription.updated plusieurs fois avec le même état).
SOURCE : webhook_handlers.py:806, 844, 892, 923 — tous vérifient _rows(res) > 0.
EXCEPTION : Events 1 et 2 (INSERT) émettent TOUJOURS la notification (pas de guard rows).
            L'idempotence est assurée par le SELECT avant INSERT.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-11 — Lookup user_id pour notifications

```
RÈGLE : Pour les events UPDATE (3, 4, 5, 6), le user_id n'est PAS dans le payload Stripe.
        Il doit être récupéré via SELECT user_id FROM user_subscriptions WHERE stripe_subscription_id=$1.
SOURCE : webhook_handlers.py:615–622 (_get_user_id_for_sub helper).
PIÈGE : Si la subscription n'existe pas en DB (webhook arrivé avant checkout.session),
        user_id=None → pas de notification. Ce n'est PAS une erreur.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-12 — subscription_id généré côté application

```
RÈGLE : Le subscription_id est généré par new_id("sub") côté application.
        Format : "sub_" + UUID abrégé (12 caractères hex).
        Ce n'est PAS le stripe_subscription_id (sub_...).
        Les deux sont stockés comme colonnes distinctes.
SOURCE : webhook_handlers.py:681, 737 — new_id("sub") avant INSERT.
PIÈGE JAVA : Ne pas confondre subscription_id (interne) et stripe_subscription_id (Stripe).
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-13 — Notifications hors connexion DB principale

```
RÈGLE : Les notifications sont collectées dans pending_notifs (liste) PENDANT
        le traitement dans la connexion DB. Elles sont envoyées APRÈS libération
        de la connexion (dans dispatch(), pas dans _handle_subscription_event).
SOURCE : webhook_handlers.py:1049–1069 (envoi des notifications après le with pool.acquire).
PIÈGE JAVA : Ne pas envoyer les notifications DANS la transaction DB.
             Pattern : collect → commit → send.
NIVEAU DE CONFIANCE : CERTAIN.
```

## BR-14 — `_dispatch_subscription` résout related_id

```
RÈGLE : Après l'appel au handler, _dispatch_subscription cherche le subscription_id
        local pour le stocker dans stripe_webhook_events.related_id.
        Logique de résolution :
        - checkout.session.completed → obj.subscription
        - customer.subscription.* → obj.id
        - invoice.* → obj.subscription
        Puis : SELECT subscription_id FROM user_subscriptions WHERE stripe_subscription_id=$1
SOURCE : webhook_handlers.py:1088–1102.
NIVEAU DE CONFIANCE : CERTAIN.
```

---

## Interactions avec S16 (webhook paiements)

| Composant S16 | Réutilisé en S20 ? | Détail |
|---|---|---|
| `_claim_event()` | OUI | Idempotence identique |
| `_mark_done()` | OUI | Statut success/error identique |
| `_resolve_payment_id()` | OUI (mais retourne None pour subscription events) | Les subscription events n'ont pas de payment_id |
| `_get()` / `_rows()` | OUI | Utilitaires identiques |
| `dispatch()` | OUI (extension) | Ajoute le bloc `if event_type in _SUBSCRIPTION_EVENTS` |
| `pending_notifs` | OUI | Même pattern collect → send |

---

## Asymétries importantes

| Asymétrie | Détail |
|---|---|
| Event 4 sans guard / Events 3,5,6 avec guard | `subscription.deleted` force `cancelled` inconditionnellement |
| Events 1,2 INSERT / Events 3,4,5,6 UPDATE | Seuls checkout et created insèrent des lignes |
| Event 1 appel Stripe / Event 2 pas d'appel Stripe | checkout.session n'a pas `current_period_end` dans le payload — nécessite retrieve |
| Events 1,2 notification inconditionnelle / Events 3-6 conditionnelle | INSERT = toujours, UPDATE = seulement si rows_updated > 0 |
| Event 3 : 2 SQL distincts / Autres : 1 SQL | subscription.updated a un SQL conditionnel sur expires_at |
| `cancelled` vs `canceled` | Stripe envoie "canceled" (US), Python accepte les deux |
