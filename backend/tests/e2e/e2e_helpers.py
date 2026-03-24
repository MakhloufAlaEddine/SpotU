"""
Helpers partagés pour les tests E2E backend
"""
import os
import requests

def _load_env():
    for path in [
        os.path.join(os.path.dirname(__file__), "../../.env"),
        os.path.join(os.path.dirname(__file__), "../../../frontend/.env"),
    ]:
        try:
            with open(path) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, value = line.partition("=")
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if value:
                        os.environ.setdefault(key, value)
        except FileNotFoundError:
            pass

_load_env()

API_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://product-showcase-461.preview.emergentagent.com")

CREDENTIALS = {
    "admin":  {"email": "admin@winek.app",  "password": "WinekAdmin2024!"},
    "coach":  {"email": "coach@winek.app",  "password": "WinekCoach2024!"},
    "user":   {"email": "user@winek.app",   "password": "WinekUser2024!"},
}

_token_cache: dict = {}


def get_token(role: str = "user") -> str:
    if role in _token_cache:
        return _token_cache[role]
    creds = CREDENTIALS[role]
    resp = requests.post(f"{API_URL}/api/auth/login", json=creds, timeout=15)
    resp.raise_for_status()
    token = resp.json()["token"]
    _token_cache[role] = token
    return token


def auth_headers(role: str = "user") -> dict:
    return {
        "Authorization": f"Bearer {get_token(role)}",
        "Content-Type": "application/json",
    }
