"""
conftest.py — Configuration globale pytest
==========================================

Garantit que EXPO_PUBLIC_BACKEND_URL est défini avant l'import de tout module
de test, même si la variable n'est pas présente dans l'environnement shell.

Charge également les variables clés du backend/.env (JWT_SECRET, DATABASE_URL…)
pour que les tests qui importent des modules backend directement puissent le faire
sans RuntimeError.

Tous les fichiers de test qui utilisent :
    BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
...obtiendront ainsi une URL valide.
"""
import os


def _load_env_file(path: str, keys: list = None):
    """
    Charge les variables d'un fichier .env dans os.environ.
    Si `keys` est fourni, ne charge que ces variables-là.
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

    # 1. frontend/.env → EXPO_PUBLIC_BACKEND_URL
    _load_env_file(
        os.path.join(base_dir, "../../frontend/.env"),
        keys=["EXPO_PUBLIC_BACKEND_URL"],
    )

    # 2. backend/.env → variables nécessaires aux imports de modules backend
    _load_env_file(
        os.path.join(base_dir, "../.env"),
        keys=["JWT_SECRET", "DATABASE_URL", "MONGO_URL", "DB_NAME", "STRIPE_API_KEY", "APP_URL", "TESTING"],
    )
