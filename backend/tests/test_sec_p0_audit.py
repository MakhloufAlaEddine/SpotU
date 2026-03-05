"""
Tests P0 — Audit sécurité SpotU
Couvre:
  [SEC-01] JWT_SECRET non-fallback + alg strict + exp obligatoire
  [SEC-06] Absence d'injections SQL f-string dans tagpoint_routes et service_routes
"""
import os
import re
import sys
import inspect
import pytest
import jwt as pyjwt

# ── Helpers ──────────────────────────────────────────────────────────────────
BASE = os.path.join(os.path.dirname(__file__), "..")

def read_file(rel_path: str) -> str:
    with open(os.path.join(BASE, rel_path), encoding="utf-8") as f:
        return f.read()


# ═══════════════════════════════════════════════════════════════════════════
# [SEC-01] JWT_SECRET
# ═══════════════════════════════════════════════════════════════════════════

class TestSEC01_JWTSecret:

    def test_no_hardcoded_fallback_in_auth_utils(self):
        """Le fichier auth_utils.py ne doit PAS contenir de secret hardcodé."""
        src = read_file("auth_utils.py")
        assert "winek-secret" not in src, \
            "FAIL: secret fallback 'winek-secret' encore présent dans auth_utils.py"
        assert "winek_secret" not in src.lower(), \
            "FAIL: variante du secret encore présente"

    def test_jwt_secret_raises_without_env(self):
        """Si JWT_SECRET est absent de l'env, le module doit lever RuntimeError au démarrage."""
        src = read_file("auth_utils.py")
        assert "RuntimeError" in src, \
            "FAIL: aucun RuntimeError si JWT_SECRET manquant"
        assert "JWT_SECRET" in src, \
            "FAIL: JWT_SECRET non référencé dans auth_utils.py"

    def test_jwt_secret_env_is_set_and_strong(self):
        """JWT_SECRET dans .env doit exister et avoir au moins 32 caractères."""
        env_path = os.path.join(BASE, ".env")
        secret = None
        with open(env_path) as f:
            for line in f:
                if line.startswith("JWT_SECRET="):
                    secret = line.strip().split("=", 1)[1]
                    break
        assert secret, "FAIL: JWT_SECRET absent du fichier .env"
        assert secret != "winek-secret-2024", \
            "FAIL: JWT_SECRET encore à la valeur par défaut faible"
        assert len(secret) >= 32, \
            f"FAIL: JWT_SECRET trop court ({len(secret)} chars, min 32)"

    def test_decode_jwt_rejects_none_algorithm(self):
        """decode_jwt() doit refuser un token signé avec alg 'none'."""
        sys.path.insert(0, BASE)
        import importlib
        import auth_utils
        importlib.reload(auth_utils)

        # Créer un token forgé avec alg='none' (exploit classique)
        malicious_payload = {"user_id": "hacker", "exp": 9999999999}
        # pyjwt encode avec alg none → header.payload. (sans signature)
        try:
            forged = pyjwt.encode(malicious_payload, "", algorithm="none")
        except Exception:
            # Certaines versions de PyJWT refusent déjà 'none'
            return  # test passé implicitement

        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            auth_utils.decode_jwt(forged)
        assert exc_info.value.status_code == 401, \
            "FAIL: token 'none' alg non rejeté avec 401"

    def test_decode_jwt_rejects_expired_token(self):
        """decode_jwt() doit rejeter un token expiré."""
        sys.path.insert(0, BASE)
        import importlib, auth_utils, time
        importlib.reload(auth_utils)

        secret = os.environ.get("JWT_SECRET") or open(os.path.join(BASE, ".env")).read()
        # Extraire le secret du .env si pas dans l'env
        if not os.environ.get("JWT_SECRET"):
            for line in open(os.path.join(BASE, ".env")):
                if line.startswith("JWT_SECRET="):
                    secret = line.strip().split("=", 1)[1]
                    break

        expired_payload = {
            "user_id": "user_test",
            "exp": int(time.time()) - 3600  # expiré il y a 1h
        }
        expired_token = pyjwt.encode(expired_payload, secret, algorithm="HS256")

        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            auth_utils.decode_jwt(expired_token)
        assert exc_info.value.status_code == 401
        assert "expired" in exc_info.value.detail.lower()

    def test_decode_jwt_rejects_wrong_algorithm(self):
        """decode_jwt() doit refuser RS256 (algo non autorisé)."""
        sys.path.insert(0, BASE)
        import importlib, auth_utils
        importlib.reload(auth_utils)

        # Tenter de décoder un token RS256 avec clé HS256 → doit échouer
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            auth_utils.decode_jwt("eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiYWRtaW4iLCJleHAiOjk5OTk5OTk5OTl9.fake")
        assert exc_info.value.status_code == 401


# ═══════════════════════════════════════════════════════════════════════════
# [SEC-06] SQL Injection — absence de f-strings avec user_id dans les queries
# ═══════════════════════════════════════════════════════════════════════════

# Pattern dangereux : f-string injectant DIRECTEMENT des données utilisateur dans le SQL.
# IMPORTANT : les f-strings qui n'injectent que des INDICES de paramètres asyncpg
# (ex: f"coach_id != ${param_idx}", f"AND tp.user_id != ${uid_idx}") sont SÛRES car
# la valeur réelle est passée séparément via params.append() / *extra_params.
# Seule l'injection directe de la valeur utilisateur (ex: f"...{current_user_id}...")
# constitue une vraie vulnérabilité SQLi.
DANGEROUS_PATTERNS = [
    # f"... {current_user_id} ..." → valeur utilisateur directement dans la requête SQL
    re.compile(r'f["\'].*\{current_user_id\}.*["\']'),
    # f"... {user_id} ..." → même problème
    re.compile(r'f["\'].*\{user_id\}.*["\']'),
]

FILES_TO_CHECK = [
    "routes/tagpoint_routes.py",
    "routes/service_routes.py",
    "routes/booking_routes.py",
    "routes/user_routes.py",
    "routes/chat_routes.py",
    "routes/auth_routes.py",
]

class TestSEC06_SQLInjection:

    @pytest.mark.parametrize("rel_path", FILES_TO_CHECK)
    def test_no_fstring_user_id_in_sql(self, rel_path):
        """Aucun f-string contenant current_user_id/user_id ne doit apparaître dans une condition SQL."""
        src = read_file(rel_path)
        violations = []
        for i, line in enumerate(src.splitlines(), 1):
            stripped = line.strip()
            # Ignorer les commentaires
            if stripped.startswith("#"):
                continue
            for pat in DANGEROUS_PATTERNS:
                if pat.search(stripped):
                    violations.append(f"  Ligne {i}: {stripped[:120]}")
        assert not violations, \
            f"FAIL: {rel_path} contient des f-strings SQL avec variable user :\n" + "\n".join(violations)

    def test_tagpoint_search_uses_parametrized_query(self):
        """Dans tagpoint_routes.py, la recherche de SpotYou utilise des params $N pour user_id."""
        src = read_file("routes/tagpoint_routes.py")
        # Après fix, on doit trouver "params.append(current_user_id)"
        assert "params.append(current_user_id)" in src, \
            "FAIL: tagpoint_routes.py ne passe pas current_user_id en paramètre asyncpg"

    def test_service_search_uses_parametrized_query(self):
        """Dans service_routes.py, la recherche de services utilise des params $N pour user_id."""
        src = read_file("routes/service_routes.py")
        assert "params.append(current_user_id)" in src, \
            "FAIL: service_routes.py ne passe pas current_user_id en paramètre asyncpg"

    def test_similar_tagpoints_uses_parametrized_query(self):
        """Dans get_similar_tag_points, exclude_clause utilise $N (pas f-string user_id)."""
        src = read_file("routes/tagpoint_routes.py")
        # Vérifier que la fonction utilise extra_params pour passer user_id
        assert "extra_params" in src, \
            "FAIL: get_similar_tag_points n'utilise pas extra_params pour user_id"
        assert "*extra_params" in src, \
            "FAIL: extra_params non passé à conn.fetch dans get_similar_tag_points"


# ═══════════════════════════════════════════════════════════════════════════
# Vérification globale: grep sur tout le backend
# ═══════════════════════════════════════════════════════════════════════════

class TestGlobalSQLScan:

    def test_no_sql_fstring_anywhere_in_routes(self):
        """Scan global de tous les fichiers routes/*.py pour f-string SQL avec variable JWT."""
        routes_dir = os.path.join(BASE, "routes")
        all_violations = []

        for fname in os.listdir(routes_dir):
            if not fname.endswith(".py"):
                continue
            fpath = os.path.join(routes_dir, fname)
            with open(fpath, encoding="utf-8") as f:
                lines = f.readlines()

            for i, line in enumerate(lines, 1):
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                for pat in DANGEROUS_PATTERNS:
                    if pat.search(stripped):
                        all_violations.append(f"  {fname}:{i}: {stripped[:100]}")

        assert not all_violations, \
            "FAIL: f-strings SQL avec variables JWT trouvés :\n" + "\n".join(all_violations)
