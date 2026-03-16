"""
Singleton du rate-limiter — SpotU
===================================
Utilise slowapi (wrapper autour de limits).

Stratégie d'identification de l'IP client :
  1. X-Forwarded-For (set par K8s Ingress / reverse proxies de confiance)
  2. Fallback sur request.client.host (connexion TCP directe)

Ce comportement permet :
  - La production derrière un ingress K8s d'avoir le bon IP client
  - Les tests d'utiliser des IPs fictives via X-Forwarded-For pour
    s'isoler les uns des autres sans Redux en mémoire partagée

En mode TESTING=true, chaque requête reçoit une clé unique → jamais limité.
"""
import os
import uuid
from fastapi import Request
from slowapi import Limiter

_TESTING = os.environ.get("TESTING", "").lower() in ("1", "true", "yes")


def _get_client_ip(request: Request) -> str:
    """
    Retourne l'IP réelle du client.

    En mode TESTING :
    - Si le header X-Test-Rate-Limit est présent → tests de rate-limiting explicites,
      on utilise le X-Forwarded-For tel quel (permet de tester que le rate limit fonctionne).
    - Sinon → clé unique par requête, jamais rate-limité
      (permet aux autres tests de s'authentifier librement).

    En production, préfère X-Forwarded-For (premier hop) si disponible.
    """
    if _TESTING:
        if request.headers.get("X-Test-Rate-Limit"):
            # Test de rate-limiting explicite : on respecte le X-Forwarded-For fourni
            forwarded_for = request.headers.get("X-Forwarded-For", "").strip()
            if forwarded_for:
                return forwarded_for.split(",")[0].strip()
        # Tous les autres tests : clé unique → jamais rate-limité
        return f"test_{uuid.uuid4().hex}"

    forwarded_for = request.headers.get("X-Forwarded-For", "").strip()
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# Instance partagée — importée par server.py et les routes
# headers_enabled=False : l'injection de headers sur les réponses 200 (dicts FastAPI)
# est incompatible avec slowapi (attend starlette.Response, pas un dict).
# Le Retry-After est ajouté manuellement dans le gestionnaire 429 de server.py.
limiter = Limiter(key_func=_get_client_ip, headers_enabled=False)
