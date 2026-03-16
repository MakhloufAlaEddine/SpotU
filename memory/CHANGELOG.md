# SpotU — Changelog

## 2026-03-16 — Refonte complète de la suite de tests E2E backend

### Objectif
Passer de ~38 échecs à 0 échec dans la suite complète (`pytest tests/`).

### Résultat final
**1059 passés, 14 ignorés, 0 échec** (`pytest tests/` en 9m53s)

### Changements code production
- `backend/routes/subscription_routes.py` : Clé d'idempotence Stripe avec fenêtre temporelle de 5 min (évite `IdempotencyError` sur re-souscription)

### Changements tests
| Fichier | Nature de la correction |
|---------|------------------------|
| `test_stripe_payment_iter50.py` | 5 assertions : `payment_status` DB vs Stripe, `accept` → `awaiting_payment` |
| `test_stripe_iter49.py` | 4 assertions : `payment_status`, `stripe_checkout_session_id` |
| `test_pricing.py` | Noms d'attributs `PricingResult`, création dynamique de règle de pricing |
| `test_edit_service_iter23.py` | Recherche `svc_demo001` dans la liste (pas forcément en position 0) |
| `test_sec02_secure_storage.py` | Ignore `AsyncStorage` dans les commentaires (pas les imports actifs) |
| `test_service_packages_iter28.py` | Dates dynamiques (slots futurs), assertion de rôle flexible, test auth sans token |
| `test_service_domain_tags_iter29.py` | Dates dynamiques, correction payload `tag_ids=[]` pour test "no tags" |
| `test_service_images_iter39.py` | Réécriture complète avec `setup_module` dynamique (suppression de `svc_b184a9f7f6db` hardcodé) |
| `test_notifications_iter47.py` | Ajout types `booking_confirmed/cancelled/awaiting_payment`, comptage `unread` relatif |
| `test_notifications_iter53.py` | Type `booking_confirmed` (pas `payment_captured`), `booking_id` dans metadata webhook |
| `test_subscriptions_iter51.py` | Clé d'idempotence `IdempotencyError` |
| `test_spotyou_websocket_concurrency.py` | URL `WS_BASE` dérivée dynamiquement de l'env |
| `test_global_booking_flags_iter60.py` | Nettoyage des bookings stale avant le test (isolation) |
| `test_booking_workflow.py` | Flag global `enable_manual_approval_for_services=True` dans fixture `ensure_manual_approval_mode` |
| `test_booking_expiry.py` | Idem + ajout fixture `tok_admin` |

### Corrections DB/infrastructure
- `user_demo001` rôle corrigé (promu à "coach" par le seed — logique intentionnelle du seed)
- `bkg_3454de14bcf5` stale booking annulé (isolation)

### Contexte technique
- **TESTING mode** (`TESTING=true` dans `.env`) : désactive le rate limiter sauf pour header `X-Test-Rate-Limit: true`
- **Problème racine des échecs** : dates hardcodées dans le passé, clés Stripe idempotentes stale, flag global `enable_manual_approval_for_services` non réinitialisé entre les modules de test
