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
    Garde de sécurité HTTP — empêche toute pollution de la base Supabase de production.

    Règle :
      • Si TEST_BASE_URL est défini → l'injecter en EXPO_PUBLIC_BACKEND_URL
        (les tests HTTP ciblent le backend de test isolé).
      • Si TEST_BASE_URL N'EST PAS défini ET que TEST_ENV=test →
        EXPO_PUBLIC_BACKEND_URL est écrasé par une URL invalide (localhost:9999).
        Les tests HTTP échoueront avec "Connection refused" au lieu de
        silencieusement écrire sur Supabase prod.
      • Si ni TEST_BASE_URL ni TEST_ENV ne sont définis →
        comportement standard (avertissement seulement, pas de blocage).

    Pour isolation complète (mode ②) :
        bash /app/backend/scripts/start_test_server.sh
        TEST_ENV=test TEST_BASE_URL=http://localhost:8002 \\
          DATABASE_URL="postgresql://winek_test:WinekTest2024!@127.0.0.1:5432/winek_test" \\
          python -m pytest tests/ -v
        bash /app/backend/scripts/start_test_server.sh --stop
    """
    test_base_url = os.environ.get("TEST_BASE_URL", "").strip()
    test_env = os.environ.get("TEST_ENV", "").strip()

    if test_base_url:
        # ✅ Mode ② : injecter TEST_BASE_URL comme URL HTTP pour tous les tests
        os.environ["EXPO_PUBLIC_BACKEND_URL"] = test_base_url
        print(f"\n[pytest] Mode ② — Tests HTTP → {test_base_url}  |  DB → winek_test\n")

    elif test_env == "test":
        # 🔒 TEST_ENV=test mais pas de TEST_BASE_URL → bloquer HTTP vers prod
        # On écrase l'URL par une adresse volontairement invalide.
        # Les tests DB (asyncpg direct) ne sont pas affectés.
        # Les tests HTTP échoueront proprement au lieu de polluer Supabase.
        _BLOCKED = "http://localhost:9999/__PRODUCTION_ACCESS_BLOCKED__"
        os.environ["EXPO_PUBLIC_BACKEND_URL"] = _BLOCKED
        import warnings
        warnings.warn(
            "\n"
            "🔒 ISOLATION ACTIVÉE — Tests HTTP BLOQUÉS (pas de TEST_BASE_URL).\n"
            "   EXPO_PUBLIC_BACKEND_URL → http://localhost:9999 (invalide intentionnellement).\n"
            "   Les tests DB (asyncpg direct) tournent normalement sur winek_test.\n"
            "   Les tests HTTP échoueront avec ConnectionError — c'est voulu.\n\n"
            "   Pour activer les tests HTTP en isolation complète :\n"
            "     bash /app/backend/scripts/start_test_server.sh\n"
            "     TEST_ENV=test TEST_BASE_URL=http://localhost:8002 \\\n"
            "       DATABASE_URL=\"postgresql://winek_test:WinekTest2024!@127.0.0.1:5432/winek_test\" \\\n"
            "       python -m pytest tests/ -v\n"
            "     bash /app/backend/scripts/start_test_server.sh --stop\n",
            UserWarning,
            stacklevel=1,
        )

    else:
        # Pas de TEST_ENV — avertissement mais sans blocage (lancement manuel explicite)
        import warnings
        warnings.warn(
            "\n"
            "⚠️  TEST_BASE_URL et TEST_ENV non définis.\n"
            "   Les tests HTTP cibleront EXPO_PUBLIC_BACKEND_URL (Supabase de production).\n"
            "   Utilisez TEST_ENV=test pour activer le blocage automatique.\n",
            UserWarning,
            stacklevel=1,
        )
