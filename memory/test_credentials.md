# Credentials de test — SpotU / winek_test

## Environnement de production (Supabase)
| Rôle | Email | Mot de passe |
|------|-------|-------------|
| Admin | admin@winek.app | WinekAdmin2024! |
| Coach | coach@winek.app | WinekCoach2024! |
| Utilisateur | user@winek.app | WinekUser2024! |
| Utilisateur 2 | mbenali@winek.app | WinekDemo2024! |
| Utilisateur 3 | cdurand@winek.app | WinekDemo2024! |

## Environnement de test local (winek_test)
Mêmes credentials que ci-dessus.
DB : `postgresql://winek_test:WinekTest2024!@127.0.0.1:5432/winek_test`

## Démarrage test server (mode ②)
```bash
bash /app/backend/scripts/start_test_server.sh
# Test avec isolation DB complète :
TEST_ENV=test TEST_BASE_URL=http://localhost:8002 \
  DATABASE_URL="postgresql://winek_test:WinekTest2024!@127.0.0.1:5432/winek_test" \
  python -m pytest tests/ -v
bash /app/backend/scripts/start_test_server.sh --stop
```


## Utilisateur standard (coach / vendeur)
- Email: user@winek.app
- Mot de passe: WinekUser2024!
- Rôle: coach / utilisateur standard

## Coach
- Email: coach@winek.app
- Mot de passe: WinekCoach2024!
- Rôle: coach (crée services et produits)

## Administrateur
- Email: admin@winek.app
- Mot de passe: WinekAdmin2024!
- Rôle: admin (validation des produits)

## URL de prévisualisation
https://spotme-ui-polish.preview.emergentagent.com

## Base de données
- Fournisseur: Supabase PostgreSQL (Supavisor session mode)
- Host: aws-0-eu-west-1.pooler.supabase.com:5432
- DB: postgres
- Migrations appliquées: 001, 002, 003

## Données de test (seed)
- 4 domaines (sport, bien-être, arts, tech)
- 5 produits marketplace seed (rental)
- 3 utilisateurs: admin, coach, user
- 3 services demo avec créneaux et localisation
