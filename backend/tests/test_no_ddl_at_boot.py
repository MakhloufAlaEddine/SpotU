"""
test_no_ddl_at_boot.py — Garde-fou anti-régression : zéro DDL au démarrage

Ce test échoue IMMÉDIATEMENT si quelqu'un réintroduit du DDL, du seed auto
ou toute modification de schéma dans le runtime de l'application.

Règle absolue :
  - Seul migrations/run_migrations.py a le droit d'exécuter du DDL.
  - Le code applicatif (server.py, database.py, workers, routes) est INTERDIT de DDL.
  - Aucun seed ne doit s'exécuter automatiquement au démarrage.

Usage :
    cd /app/backend && python -m pytest tests/test_no_ddl_at_boot.py -v
"""

import ast
import re
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).parent.parent

# Fichiers du runtime d'application (jamais censés contenir du DDL)
RUNTIME_FILES = [
    BACKEND_ROOT / "database.py",
    BACKEND_ROOT / "server.py",
    BACKEND_ROOT / "seed.py",
    BACKEND_ROOT / "expiry_worker.py",
    BACKEND_ROOT / "spot_you_notif_worker.py",
    BACKEND_ROOT / "admin_product_reminder_worker.py",
    BACKEND_ROOT / "stripe_service.py",
    BACKEND_ROOT / "webhook_handlers.py",
    BACKEND_ROOT / "pricing_engine.py",
    BACKEND_ROOT / "auth_utils.py",
    BACKEND_ROOT / "push_service.py",
    BACKEND_ROOT / "r2_storage.py",
]

ROUTE_FILES = list((BACKEND_ROOT / "routes").glob("*.py"))

ALL_RUNTIME_FILES = RUNTIME_FILES + ROUTE_FILES

# Mots-clés DDL strictement interdits dans le code runtime
DDL_FORBIDDEN = [
    r"\bCREATE\s+TABLE\b",
    r"\bALTER\s+TABLE\b",
    r"\bDROP\s+TABLE\b",
    r"\bCREATE\s+INDEX\b",
    r"\bDROP\s+INDEX\b",
    r"\bADD\s+COLUMN\b",
    r"\bDROP\s+COLUMN\b",
    r"\bRENAME\s+COLUMN\b",
    r"\bRENAME\s+TABLE\b",
    r"\bCREATE\s+TYPE\b",
    r"\bDROP\s+TYPE\b",
    r"\bCREATE\s+SCHEMA\b",
    r"\bDROP\s+SCHEMA\b",
    r"\bCREATE\s+SEQUENCE\b",
    r"\bTRUNCATE\s+TABLE\b",
    r"\bCREATE\s+EXTENSION\b",
]

_DDL_RE = re.compile("|".join(DDL_FORBIDDEN), re.IGNORECASE)

# Commentaires autorisés (ex: "# max_duration_days supprimé")
_COMMENT_RE = re.compile(r"^\s*#")


def _find_ddl_in_file(path: Path) -> list[tuple[int, str]]:
    """Retourne les lignes contenant du DDL (hors commentaires Python)."""
    if not path.exists():
        return []
    violations = []
    for lineno, line in enumerate(path.read_text().splitlines(), 1):
        if _COMMENT_RE.match(line):
            continue
        if _DDL_RE.search(line):
            violations.append((lineno, line.strip()))
    return violations


def _get_startup_code(server_path: Path) -> str:
    """Extrait le corps des fonctions startup/shutdown de server.py."""
    src = server_path.read_text()
    tree = ast.parse(src)
    startup_lines = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
            if node.name in ("startup", "shutdown", "lifespan"):
                # Récupérer les lignes de cette fonction
                lines = src.splitlines()
                for i in range(node.lineno - 1, node.end_lineno):
                    startup_lines.append(lines[i])
    return "\n".join(startup_lines)


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_database_py_has_no_ddl():
    """database.py ne doit contenir aucun DDL — zéro CREATE/ALTER/DROP."""
    violations = _find_ddl_in_file(BACKEND_ROOT / "database.py")
    assert not violations, (
        "DDL trouvé dans database.py !\n"
        + "\n".join(f"  Ligne {ln}: {txt}" for ln, txt in violations)
        + "\n→ Le schéma ne doit évoluer que via migrations/run_migrations.py"
    )


def test_database_py_functions():
    """database.py doit exposer uniquement les fonctions de connexion (pas de DDL)."""
    src = (BACKEND_ROOT / "database.py").read_text()
    tree = ast.parse(src)
    async_funcs = {n.name for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef)}
    allowed = {"_init_connection", "connect_to_db", "close_db"}
    extra = async_funcs - allowed
    assert not extra, (
        f"Fonctions async inattendues dans database.py : {extra}\n"
        "→ Aucune logique DDL/seed ne doit être ajoutée."
    )


def test_server_startup_has_no_ddl():
    """server.py: le hook startup ne doit pas exécuter de DDL."""
    startup_code = _get_startup_code(BACKEND_ROOT / "server.py")
    violations = [(0, line.strip()) for line in startup_code.splitlines()
                  if not _COMMENT_RE.match(line) and _DDL_RE.search(line)]
    assert not violations, (
        "DDL trouvé dans startup() de server.py !\n"
        + "\n".join(f"  {txt}" for _, txt in violations)
    )


def test_server_startup_has_no_seed_call():
    """server.py: le hook startup ne doit pas appeler seed_initial_data ni importer seed."""
    startup_code = _get_startup_code(BACKEND_ROOT / "server.py")
    assert "seed_initial_data" not in startup_code, (
        "seed_initial_data() appelé dans startup() de server.py !\n"
        "→ Le seed doit être CLI uniquement : python seed.py"
    )
    assert "import seed" not in startup_code, (
        "'import seed' trouvé dans startup() de server.py !\n"
        "→ seed.py ne doit jamais être importé au démarrage."
    )


def test_seed_py_has_main_guard():
    """seed.py doit avoir un guard __name__ == '__main__' pour éviter l'exécution auto."""
    src = (BACKEND_ROOT / "seed.py").read_text()
    tree = ast.parse(src)
    has_guard = any(
        isinstance(n, ast.If)
        and isinstance(getattr(n, "test", None), ast.Compare)
        and isinstance(getattr(n.test, "left", None), ast.Name)
        and n.test.left.id == "__name__"
        for n in ast.iter_child_nodes(tree)
    )
    assert has_guard, (
        "Guard 'if __name__ == \"__main__\":' absent de seed.py !\n"
        "→ Sans ce guard, seed.py peut s'exécuter automatiquement à l'import."
    )


def test_seed_py_no_toplevel_db_calls():
    """seed.py: aucun appel à seed_initial_data() ni await au niveau module."""
    src = (BACKEND_ROOT / "seed.py").read_text()
    tree = ast.parse(src)
    for node in ast.iter_child_nodes(tree):
        # Les seules choses autorisées au toplevel : imports, assignments, def, class, if __main__
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Await):
            raise AssertionError(
                f"Appel 'await' au niveau module dans seed.py (ligne {node.lineno}) !\n"
                "→ Aucune coroutine ne doit s'exécuter à l'import de seed.py."
            )
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            call_src = ast.unparse(node.value)
            if "seed_initial_data" in call_src or "asyncio.run" in call_src:
                raise AssertionError(
                    f"Appel direct '{call_src}' au toplevel de seed.py (ligne {node.lineno}) !\n"
                    "→ Ce code s'exécuterait à chaque import."
                )


def test_workers_have_no_ddl():
    """Les workers ne doivent contenir aucun DDL (uniquement DML opérationnel)."""
    worker_files = [
        BACKEND_ROOT / "expiry_worker.py",
        BACKEND_ROOT / "spot_you_notif_worker.py",
        BACKEND_ROOT / "admin_product_reminder_worker.py",
    ]
    all_violations = {}
    for wf in worker_files:
        v = _find_ddl_in_file(wf)
        if v:
            all_violations[wf.name] = v
    assert not all_violations, (
        "DDL trouvé dans des workers !\n"
        + "\n".join(
            f"  {fname}:\n" + "\n".join(f"    Ligne {ln}: {txt}" for ln, txt in viols)
            for fname, viols in all_violations.items()
        )
    )


def test_route_files_have_no_ddl():
    """Les routes ne doivent contenir aucun DDL."""
    all_violations = {}
    for rf in ROUTE_FILES:
        v = _find_ddl_in_file(rf)
        if v:
            all_violations[rf.name] = v
    assert not all_violations, (
        "DDL trouvé dans des fichiers de routes !\n"
        + "\n".join(
            f"  {fname}:\n" + "\n".join(f"    Ligne {ln}: {txt}" for ln, txt in viols)
            for fname, viols in all_violations.items()
        )
    )


def test_all_runtime_files_clean():
    """Test de synthèse : aucun fichier runtime ne contient de DDL."""
    all_violations = {}
    for f in ALL_RUNTIME_FILES:
        v = _find_ddl_in_file(f)
        if v:
            all_violations[str(f.relative_to(BACKEND_ROOT))] = v
    assert not all_violations, (
        f"{len(all_violations)} fichier(s) avec du DDL détecté :\n"
        + "\n".join(
            f"  {fname}: {len(viols)} violation(s)"
            for fname, viols in all_violations.items()
        )
        + "\n→ Utilisez uniquement migrations/run_migrations.py pour tout DDL."
    )
