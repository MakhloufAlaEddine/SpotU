"""
conftest.py — Configuration globale pytest
==========================================

Garantit que EXPO_PUBLIC_BACKEND_URL est défini avant l'import de tout module
de test, même si la variable n'est pas présente dans l'environnement shell.

Charge également les variables clés du backend/.env (JWT_SECRET, DATABASE_URL…)
pour que les tests qui importent des modules backend directement puissent le faire
sans RuntimeError.

Mode test local (TEST_ENV=test) :
    Charge .env.test EN PRIORITÉ pour DATABASE_URL → pointe sur winek_test local.
    Les autres variables (JWT_SECRET, STRIPE_API_KEY…) tombent en fallback sur .env.
    Pour utiliser ce mode :
        TEST_ENV=test pytest tests/
        # ou via le script :
        bash /app/backend/scripts/run_tests.sh

Tous les fichiers de test qui utilisent :
    BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
...obtiendront ainsi une URL valide.
"""
import os


def _load_env_file(path: str, keys: list = None):
    """
    Charge les variables d'un fichier .env dans os.environ.
    Si `keys` est fourni, ne charge que ces variables-là.
    Utilise setdefault : ne remplace JAMAIS une variable déjà définie.
    """
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if keys is None or key in keys:
                    if value:
                        os.environ.setdefault(key, value)
    except Exception:
        pass


def pytest_configure(config):
    """Injecte les variables d'environnement nécessaires depuis les fichiers .env."""
    base_dir = os.path.dirname(__file__)

    # ── Priorité 1 : .env.test si TEST_ENV=test (DATABASE_URL → winek_test local) ──
    if os.environ.get("TEST_ENV") == "test":
        _load_env_file(
            os.path.join(base_dir, "../.env.test"),
            keys=["DATABASE_URL", "JWT_SECRET", "STRIPE_API_KEY", "APP_URL", "TESTING"],
        )

    # ── Priorité 2 : frontend/.env → EXPO_PUBLIC_BACKEND_URL ────────────────────
    _load_env_file(
        os.path.join(base_dir, "../../frontend/.env"),
        keys=["EXPO_PUBLIC_BACKEND_URL"],
    )

    # ── Priorité 3 : backend/.env → fallback pour toutes les autres variables ────
    # setdefault : ne remplace pas les valeurs déjà chargées depuis .env.test
    _load_env_file(
        os.path.join(base_dir, "../.env"),
        keys=["JWT_SECRET", "DATABASE_URL", "MONGO_URL", "DB_NAME", "STRIPE_API_KEY", "APP_URL", "TESTING"],
    )


def pytest_sessionstart(session):
    """
    Avertissement de sécurité au démarrage de la session pytest.

    Si TEST_BASE_URL n'est PAS défini, les tests HTTP utilisent
    EXPO_PUBLIC_BACKEND_URL (backend Supabase de production).
    Cela peut créer de vraies réservations et envoyer de vraies notifications
    aux comptes réels.

    Pour éviter toute pollution :
      bash /app/backend/scripts/start_test_server.sh
      TEST_ENV=test TEST_BASE_URL=http://localhost:8002 \\
        DATABASE_URL="postgresql://winek_test:WinekTest2024!@127.0.0.1:5432/winek_test" \\
        python -m pytest tests/ -v
    """
    test_base_url = os.environ.get("TEST_BASE_URL")
    if not test_base_url:
        import warnings
        warnings.warn(
            "\n"
            "⚠️  TEST_BASE_URL non défini — les tests HTTP cibleront le backend de PRODUCTION (Supabase).\n"
            "   Cela peut créer de vraies réservations et envoyer de vraies notifications aux comptes réels.\n"
            "   Pour isolation complète, utiliser le mode ② :\n"
            "     bash /app/backend/scripts/start_test_server.sh\n"
            "     TEST_ENV=test TEST_BASE_URL=http://localhost:8002 \\\n"
            "       DATABASE_URL=\"postgresql://winek_test:WinekTest2024!@127.0.0.1:5432/winek_test\" \\\n"
            "       python -m pytest tests/ -v\n",
            UserWarning,
            stacklevel=1,
        )
