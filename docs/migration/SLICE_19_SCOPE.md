# SLICE_19_SCOPE.md — Cadrage de la Slice 19
> Basé sur `stripe_service.py` (intégral), `booking_routes.py:524–530,726–732,882–912`, `expiry_worker.py:173–179`.
> Généré le 2026-02-XX.

---

## Flow choisi — `StripeService` : les 3 appels réseau réels

### Cible

Remplacer **tous** les stubs Stripe écrits dans les Slices 12, 13, 15 et 18 par les appels SDK réels.
3 méthodes réseau + infrastructure partagée (initialisation SDK, wrapping async, mapping de raisons).

| # | Méthode Python | Signature | Stubs à remplacer |
|---|---|---|---|
| 1 | `capture_payment_intent(intent_id, amount_to_capture?)` | `PaymentIntent.capture(id, params)` | Slice 13 (accept Cas A) |
| 2 | `cancel_payment_intent(intent_id, reason)` | `PaymentIntent.cancel(id, params)` | Slice 12 (refuse), Slice 15 (cancel), Slice 18 (expiry) |
| 3 | `create_refund(charge_id, amount_cents?, reason, idempotency_key?)` | `Refund.create(params)` | Slice 15 (cancel post-capture) |

---

## Justification du choix

### Pourquoi les 3 ensemble (et non un seul) ?

| Critère | Justification |
|---|---|
| **Même module source** | Les 3 sont dans `stripe_service.py` (lignes 136–237) — c'est un seul composant cohérent |
| **Même SDK / même init** | Tous partagent `stripe.api_key`, `_run_sync()`, `stripe.api_base` (proxy Emergent) |
| **Même pattern d'appel** | `asyncio.to_thread(fn, *args)` → en Java : appel SDK synchrone dans un service Spring |
| **Même gestion d'erreur** | try/except + log.error + erreur avalée — pattern identique dans les 3 callers |
| **Élimination de TOUS les stubs** | Après cette slice, 0 stub Stripe restant dans le cycle booking write (S12–S18) |
| **Fragmentation évitée** | Documenter capture seul forcerait à re-documenter cancel/refund dans S20/S21 avec le même SDK |

### Pourquoi MAINTENANT ?

| Critère | Valeur |
|---|---|
| Booking write complet (S11–S18) | Tous les endpoints et workers sont documentés — les stubs sont la SEULE dette restante |
| Revenue collection | Sans capture réelle, la plateforme ne collecte pas d'argent → fonctionnalité P0 |
| Cycle financier fermé | capture + cancel + refund = le cycle complet argent (autoriser → capturer → rembourser) |
| Pré-requis absent | Aucune dépendance non documentée — Stripe SDK Java est standalone |

### Comparaison des candidats (demandée par l'utilisateur)

| Candidat | Appels réseau | Slices impactées | Complexité | Structurant ? |
|---|---|---|---|---|
| Refund réel (cancel) | 1 | S15 | FAIBLE | ❌ Partiel |
| Cancel PI réel (expiry) | 1 | S12, S15, S18 | FAIBLE | ❌ Partiel |
| Capture réelle (accept) | 1 | S13 | FAIBLE | ❌ Partiel |
| **StripeService complet** ✅ | **3** | **S12, S13, S15, S18** | **MOYEN** | **✅ Élimine TOUS les stubs** |

---

## Fichiers Python analysés

| Fichier | Lignes | Rôle dans cette slice |
|---|---|---|
| `stripe_service.py` | 1–237 | **Source principale** — les 3 méthodes + init + helpers |
| `stripe_service.py` | 30–45 | Init SDK (`_init_stripe`), proxy Emergent, `_run_sync` |
| `stripe_service.py` | 136–153 | `capture_payment_intent` |
| `stripe_service.py` | 156–185 | `cancel_payment_intent` + `_CANCEL_REASONS` |
| `stripe_service.py` | 195–237 | `create_refund` + `_REFUND_REASONS` |
| `booking_routes.py` | 524–530 | Caller capture (accept Cas A) |
| `booking_routes.py` | 726–732 | Caller cancel PI (refuse) |
| `booking_routes.py` | 882–912 | Caller cancel PI + refund (cancel) |
| `expiry_worker.py` | 173–179 | Caller cancel PI (expiry worker) |

---

## Auth

**N/A** — `StripeService` est un service interne, pas un endpoint HTTP.
L'authentification est gérée par les callers (endpoints des Slices 12, 13, 15, 18).

---

## Dépendances

| Dépendance | Type | Rôle |
|---|---|---|
| Stripe Java SDK (`com.stripe:stripe-java`) | Librairie externe | Appels réseau : `PaymentIntent.capture()`, `PaymentIntent.cancel()`, `Refund.create()` |
| `STRIPE_API_KEY` | Variable d'environnement | Clé secrète `sk_test_...` ou `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Variable d'environnement | Hors scope direct mais lue dans le même init |
| `Stripe.apiBase` override | Conditionnel | Si clé contient `sk_test_emergent` → proxy `https://integrations.emergentagent.com/stripe` |
| Aucune table DB | — | Le service ne fait AUCUN accès DB — les callers gèrent la DB |

---

## Scope explicite — Ce qui est INCLUS vs EXCLU

### INCLUS (Slice 19)

| Méthode | Lignes Python |
|---|---|
| `_init_stripe()` | 34–45 |
| `_run_sync(fn, *args, **kwargs)` | 48–50 |
| `capture_payment_intent(intent_id, amount_to_capture?)` | 138–153 |
| `cancel_payment_intent(intent_id, reason)` | 166–185 |
| `create_refund(charge_id, amount_cents?, reason, idempotency_key?)` | 199–237 |
| `_CANCEL_REASONS` dict | 158–164 |
| `_REFUND_REASONS` set | 197 |
| `retrieve_payment_intent(intent_id)` | 190–192 |

### EXCLU (hors scope)

| Méthode | Raison |
|---|---|
| `get_or_create_customer()` | Checkout flow — Slice 17 |
| `create_payment_intent()` | Non utilisé directement (checkout crée son PI) |
| `create_checkout_session()` / `retrieve_checkout_session()` | Slice 17 |
| `parse_webhook_event()` | Slice 16 |
| `ensure_subscription_price()` / `create_subscription_checkout_session()` | Subscriptions — exclu par l'utilisateur |
| `cancel_subscription()` / `retrieve_subscription()` | Subscriptions — exclu par l'utilisateur |

---

## Niveau de risque

**MOYEN.**

| Point | Risque | Détail |
|---|---|---|
| Appels réseau externes | MOYEN | Timeout, erreurs Stripe, réseau down → toujours hors transaction |
| Idempotency keys | FAIBLE | Présentes dans refund uniquement (`rf_{booking_id}`) — capture et cancel sont naturellement idempotents |
| Mapping de raisons | FAIBLE | `_CANCEL_REASONS` : 5 entrées Python → Map Java avec fallback `"abandoned"` |
| Proxy Emergent | FAIBLE | Conditionnel sur `sk_test_emergent` dans la clé — config property Spring |
| Partial capture | FAIBLE | `amount_to_capture` optionnel — pas utilisé dans le code actuel (toujours full capture) |
| Partial refund | FAIBLE | `amount_cents` optionnel — pas utilisé dans le code actuel (toujours full refund) |

---

## Résumé ultra court

- **Flow choisi** : `StripeService` Java complet — capture + cancel + refund (3 méthodes réseau réelles)
- **Tables touchées** : AUCUNE (service pur réseau, les callers gèrent la DB)
- **Top 3 pièges** :
  1. **Hors transaction OBLIGATOIRE** — les 3 appels Stripe DOIVENT être après le COMMIT DB (déjà respecté dans S12–S18, mais le service Java ne doit PAS être `@Transactional`)
  2. **Idempotency key refund** — format `rf_{booking_id}` — si la clé est réutilisée, Stripe retourne le refund existant (pas d'erreur)
  3. **Erreur avalée** — les 3 callers Python font `try/except: log.error(...)` — l'échec Stripe ne rollback PAS la DB (le booking est déjà en état final)
- **Raison du choix** : élimine les 4 derniers stubs du cycle booking write en un seul composant cohérent
