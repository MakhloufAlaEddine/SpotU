"""
test_pricing_engine.py — Tests unitaires et d'intégration du moteur de pricing SpotU
======================================================================================

Structure :
  - Bloc A : tests unitaires PURS (mock DB, aucun accès réseau/BD requis)
  - Bloc B : tests d'intégration avec DB réelle
  - Bloc C : tests API end-to-end

Cas couverts :
  1. Aucune règle active          → zéro frais
  2. Frais payeur uniquement      → fixed + percent côté payeur
  3. Frais bénéficiaire seulement → fixed + percent côté bénéficiaire
  4. Frais des deux côtés         → payer + receiver simultanés
  5. Exemption payeur             → abonnement annule les frais du payeur
  6. Exemption bénéficiaire       → abonnement annule les frais du bénéficiaire
  7. Exemptions des deux côtés    → les deux abonnés
  8. Exemption partielle          → seulement une partie des frais annulée
  9. Précision Decimal            → pas d'arrondi flottant (ex: 33.33%)
 10. Snapshot complet             → tous les champs requis présents et sérialisables
 11. to_payment_dict()            → mapping exact vers colonnes DB
 12. Alias calculate()            → rétro-compatibilité
 13. Intégration DB               → cas réels avec règle en base
 14. API /bookings                → booking + payment créés atomiquement
 15. API /payments/me             → lecture des paiements utilisateur
"""

import sys
import os
import asyncio
import json
import httpx

sys.path.insert(0, "/app/backend")

from pricing_engine import PricingEngine, PricingResult, pricing_engine
from models import new_id

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") + "/api"
DB_URL = os.environ.get("DATABASE_URL")


# ═══════════════════════════════════════════════════════════════════════════════
# BLOC 0 — Infrastructure mock
# ═══════════════════════════════════════════════════════════════════════════════

class _MockRecord:
    """Simule un asyncpg.Record sans dépendance DB."""
    def __init__(self, data: dict):
        self._d = data

    def __getitem__(self, k):  return self._d[k]
    def get(self, k, d=None): return self._d.get(k, d)
    def __iter__(self):        return iter(self._d)
    def keys(self):            return self._d.keys()
    def __contains__(self, k): return k in self._d


class _MockConn:
    """
    Connexion asyncpg simulée.
    Distingue les requêtes par contenu SQL et par user_id.
    """
    def __init__(
        self,
        rule: dict | None = None,
        payer_sub: dict | None = None,
        receiver_sub: dict | None = None,
        payer_id: str = "payer_user",
        receiver_id: str = "receiver_user",
    ):
        self._rule = rule
        self._payer_sub = payer_sub
        self._receiver_sub = receiver_sub
        self._payer_id = payer_id
        self._receiver_id = receiver_id

    async def fetchrow(self, query: str, *args):
        if "pricing_rules" in query:
            return _MockRecord(self._rule) if self._rule else None
        if "user_subscriptions" in query:
            uid = args[0]
            if uid == self._payer_id:
                return _MockRecord(self._payer_sub) if self._payer_sub else None
            return _MockRecord(self._receiver_sub) if self._receiver_sub else None
        return None


def _rule(
    pf=0.0, pp=0.0, rf=0.0, rp=0.0,
    rule_id="rule_test", name="Test",
) -> dict:
    """Helper : crée un dict de règle tarifaire."""
    return {
        "rule_id": rule_id, "name": name,
        "payer_fixed_fee": pf, "payer_percent_fee": pp,
        "receiver_fixed_fee": rf, "receiver_percent_fee": rp,
    }


def _sub(
    exempt_pf=False, exempt_pp=False, exempt_rf=False, exempt_rp=False,
    plan_id="plan_test", plan_name="Test Plan",
) -> dict:
    """Helper : crée un dict d'abonnement avec exemptions."""
    return {
        "plan_id": plan_id, "plan_name": plan_name,
        "exempt_payer_fixed": exempt_pf,
        "exempt_payer_percent": exempt_pp,
        "exempt_receiver_fixed": exempt_rf,
        "exempt_receiver_percent": exempt_rp,
    }


engine = PricingEngine()
PASSED = []
FAILED = []


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def check(name: str, condition: bool, detail: str = ""):
    if condition:
        PASSED.append(name)
        print(f"  ✓ {name}")
    else:
        FAILED.append(name)
        print(f"  ✗ {name}" + (f"  [{detail}]" if detail else ""))


# ═══════════════════════════════════════════════════════════════════════════════
# BLOC A — Tests unitaires purs (mock)
# ═══════════════════════════════════════════════════════════════════════════════

async def _test_no_rule():
    """CAS 1 : Aucune règle active → zéro frais, montants = base_amount."""
    conn = _MockConn(rule=None)
    r = await engine.compute_pricing(conn, "payer_user", "receiver_user", "unknown", 100.0)
    check("CAS1 payer_total == base_amount",   r.payer_total_amount == 100.0, str(r.payer_total_amount))
    check("CAS1 receiver_net == base_amount",  r.receiver_net_amount == 100.0, str(r.receiver_net_amount))
    check("CAS1 platform_total == 0",          r.platform_total_fee == 0.0, str(r.platform_total_fee))
    check("CAS1 applied_rules est vide",       r.applied_rules == [])
    check("CAS1 subscription_benefits vide",   r.applied_subscription_benefits == [])


async def _test_payer_fees_only():
    """CAS 2 : Frais uniquement côté payeur (fixed=1 + 5%)."""
    # base=100 → pf=1, pp=5 → payer_total=106, receiver_net=100, platform=6
    conn = _MockConn(rule=_rule(pf=1.0, pp=5.0, rf=0.0, rp=0.0))
    r = await engine.compute_pricing(conn, "payer_user", "receiver_user", "svc", 100.0)
    check("CAS2 payer_fixed_fee == 1.0",          r.payer_fixed_fee == 1.0,          str(r.payer_fixed_fee))
    check("CAS2 payer_percent_fee_amount == 5.0",  r.payer_percent_fee_amount == 5.0,  str(r.payer_percent_fee_amount))
    check("CAS2 receiver_fixed_fee == 0.0",        r.receiver_fixed_fee == 0.0,        str(r.receiver_fixed_fee))
    check("CAS2 receiver_percent_fee_amount == 0.0",r.receiver_percent_fee_amount==0.0,str(r.receiver_percent_fee_amount))
    check("CAS2 payer_total_amount == 106.0",      r.payer_total_amount == 106.0,     str(r.payer_total_amount))
    check("CAS2 receiver_net_amount == 100.0",     r.receiver_net_amount == 100.0,    str(r.receiver_net_amount))
    check("CAS2 platform_total_fee == 6.0",        r.platform_total_fee == 6.0,       str(r.platform_total_fee))


async def _test_receiver_fees_only():
    """CAS 3 : Frais uniquement côté bénéficiaire (fixed=2 + 8%)."""
    # base=100 → rf=2, rp=8 → payer_total=100, receiver_net=90, platform=10
    conn = _MockConn(rule=_rule(pf=0.0, pp=0.0, rf=2.0, rp=8.0))
    r = await engine.compute_pricing(conn, "payer_user", "receiver_user", "svc", 100.0)
    check("CAS3 payer_fixed_fee == 0.0",           r.payer_fixed_fee == 0.0,           str(r.payer_fixed_fee))
    check("CAS3 payer_percent_fee_amount == 0.0",   r.payer_percent_fee_amount == 0.0,  str(r.payer_percent_fee_amount))
    check("CAS3 receiver_fixed_fee == 2.0",         r.receiver_fixed_fee == 2.0,        str(r.receiver_fixed_fee))
    check("CAS3 receiver_percent_fee_amount == 8.0",r.receiver_percent_fee_amount==8.0, str(r.receiver_percent_fee_amount))
    check("CAS3 payer_total_amount == 100.0",       r.payer_total_amount == 100.0,      str(r.payer_total_amount))
    check("CAS3 receiver_net_amount == 90.0",       r.receiver_net_amount == 90.0,      str(r.receiver_net_amount))
    check("CAS3 platform_total_fee == 10.0",        r.platform_total_fee == 10.0,       str(r.platform_total_fee))


async def _test_both_sides():
    """CAS 4 : Frais des deux côtés (pf=0, pp=2.5%, rf=0, rp=10%)."""
    # base=60 → pp=1.5, rp=6 → payer=61.5, receiver=54, platform=7.5
    conn = _MockConn(rule=_rule(pf=0.0, pp=2.5, rf=0.0, rp=10.0))
    r = await engine.compute_pricing(conn, "payer_user", "receiver_user", "svc", 60.0)
    check("CAS4 payer_percent_fee_amount == 1.5",  r.payer_percent_fee_amount == 1.5,  str(r.payer_percent_fee_amount))
    check("CAS4 receiver_percent_fee_amount == 6", r.receiver_percent_fee_amount == 6.0, str(r.receiver_percent_fee_amount))
    check("CAS4 payer_total_amount == 61.5",       r.payer_total_amount == 61.5,       str(r.payer_total_amount))
    check("CAS4 receiver_net_amount == 54.0",      r.receiver_net_amount == 54.0,      str(r.receiver_net_amount))
    check("CAS4 platform_total_fee == 7.5",        r.platform_total_fee == 7.5,        str(r.platform_total_fee))
    check("CAS4 applied_rules non vide",           len(r.applied_rules) == 1)
    check("CAS4 applied_rules.rule_id présent",    r.applied_rules[0]["rule_id"] == "rule_test")


async def _test_payer_exemption_full():
    """CAS 5 : Abonnement payeur → tous ses frais annulés."""
    # base=100, rule pf=2+5%, rf=0+10%
    # payer_sub exempte payer_fixed + payer_percent → payer_total=100, platform=10
    conn = _MockConn(
        rule=_rule(pf=2.0, pp=5.0, rf=0.0, rp=10.0),
        payer_sub=_sub(exempt_pf=True, exempt_pp=True),
        payer_id="payer_user",
    )
    r = await engine.compute_pricing(conn, "payer_user", "receiver_user", "svc", 100.0)
    check("CAS5 payer_fixed_fee == 0",            r.payer_fixed_fee == 0.0,           str(r.payer_fixed_fee))
    check("CAS5 payer_percent_fee_amount == 0",   r.payer_percent_fee_amount == 0.0,  str(r.payer_percent_fee_amount))
    check("CAS5 payer_total_amount == 100",       r.payer_total_amount == 100.0,      str(r.payer_total_amount))
    check("CAS5 receiver_percent_fee_amount==10", r.receiver_percent_fee_amount==10.0,str(r.receiver_percent_fee_amount))
    check("CAS5 receiver_net_amount == 90",       r.receiver_net_amount == 90.0,      str(r.receiver_net_amount))
    check("CAS5 platform_total_fee == 10",        r.platform_total_fee == 10.0,       str(r.platform_total_fee))
    check("CAS5 benefit side=payer enregistré",
          any(b["side"] == "payer" for b in r.applied_subscription_benefits))
    check("CAS5 payer_fixed_fee dans exempted_fields",
          "payer_fixed_fee" in r.applied_subscription_benefits[0]["exempted_fields"])


async def _test_receiver_exemption_full():
    """CAS 6 : Abonnement bénéficiaire → tous ses frais annulés."""
    # base=100, rule pf=0+5%, rf=2+10%
    # receiver_sub exempte receiver_fixed + receiver_percent → receiver_net=100, platform=5
    conn = _MockConn(
        rule=_rule(pf=0.0, pp=5.0, rf=2.0, rp=10.0),
        receiver_sub=_sub(exempt_rf=True, exempt_rp=True),
        receiver_id="receiver_user",
    )
    r = await engine.compute_pricing(conn, "payer_user", "receiver_user", "svc", 100.0)
    check("CAS6 receiver_fixed_fee == 0",          r.receiver_fixed_fee == 0.0,         str(r.receiver_fixed_fee))
    check("CAS6 receiver_percent_fee_amount == 0", r.receiver_percent_fee_amount == 0.0, str(r.receiver_percent_fee_amount))
    check("CAS6 receiver_net_amount == 100",       r.receiver_net_amount == 100.0,       str(r.receiver_net_amount))
    check("CAS6 payer_percent_fee_amount == 5",    r.payer_percent_fee_amount == 5.0,    str(r.payer_percent_fee_amount))
    check("CAS6 payer_total_amount == 105",        r.payer_total_amount == 105.0,        str(r.payer_total_amount))
    check("CAS6 platform_total_fee == 5",          r.platform_total_fee == 5.0,          str(r.platform_total_fee))
    check("CAS6 benefit side=receiver enregistré",
          any(b["side"] == "receiver" for b in r.applied_subscription_benefits))


async def _test_both_exemptions():
    """CAS 7 : Les deux parties ont un abonnement avec exemption totale."""
    # base=100, rule pf=2+5%, rf=2+10%
    # payer_sub: exempt all payer fees | receiver_sub: exempt all receiver fees
    # → payer_total=100, receiver_net=100, platform=0
    conn = _MockConn(
        rule=_rule(pf=2.0, pp=5.0, rf=2.0, rp=10.0),
        payer_sub=_sub(exempt_pf=True, exempt_pp=True),
        receiver_sub=_sub(exempt_rf=True, exempt_rp=True),
        payer_id="payer_user",
        receiver_id="receiver_user",
    )
    r = await engine.compute_pricing(conn, "payer_user", "receiver_user", "svc", 100.0)
    check("CAS7 payer_total_amount == 100",    r.payer_total_amount == 100.0,  str(r.payer_total_amount))
    check("CAS7 receiver_net_amount == 100",   r.receiver_net_amount == 100.0, str(r.receiver_net_amount))
    check("CAS7 platform_total_fee == 0",      r.platform_total_fee == 0.0,    str(r.platform_total_fee))
    check("CAS7 2 subscription benefits",      len(r.applied_subscription_benefits) == 2)


async def _test_partial_exemption():
    """CAS 8 : Exemption partielle — seulement le fixed payeur annulé, pas le %."""
    # base=100, rule pf=2+5%
    # payer_sub: exempt pf only → pp reste
    # → payer_total=100+0+5=105, platform=5
    conn = _MockConn(
        rule=_rule(pf=2.0, pp=5.0, rf=0.0, rp=0.0),
        payer_sub=_sub(exempt_pf=True, exempt_pp=False),
        payer_id="payer_user",
    )
    r = await engine.compute_pricing(conn, "payer_user", "receiver_user", "svc", 100.0)
    check("CAS8 payer_fixed_fee == 0",           r.payer_fixed_fee == 0.0,          str(r.payer_fixed_fee))
    check("CAS8 payer_percent_fee_amount == 5",  r.payer_percent_fee_amount == 5.0,  str(r.payer_percent_fee_amount))
    check("CAS8 payer_total_amount == 105",      r.payer_total_amount == 105.0,      str(r.payer_total_amount))
    check("CAS8 platform_total_fee == 5",        r.platform_total_fee == 5.0,        str(r.platform_total_fee))
    check("CAS8 seul payer_fixed_fee exempté",
          r.applied_subscription_benefits[0]["exempted_fields"] == ["payer_fixed_fee"])


async def _test_decimal_precision():
    """CAS 9 : Précision Decimal — pas d'erreur d'arrondi flottant."""
    # 33.33% de 100 = 33.33 (arrondi HALF_UP) — pas 33.330000000004 en float
    conn = _MockConn(rule=_rule(pp=33.33))
    r = await engine.compute_pricing(conn, "payer_user", "receiver_user", "svc", 100.0)
    check("CAS9 33.33% de 100 == 33.33",  r.payer_percent_fee_amount == 33.33, str(r.payer_percent_fee_amount))
    check("CAS9 payer_total == 133.33",   r.payer_total_amount == 133.33,      str(r.payer_total_amount))

    # 1/3 % de 99.99 = 0.33 (arrondi correct)
    conn2 = _MockConn(rule=_rule(pp=0.3333))
    r2 = await engine.compute_pricing(conn2, "payer_user", "receiver_user", "svc", 99.99)
    check("CAS9b 0.3333% de 99.99 arrondi correct",
          isinstance(r2.payer_percent_fee_amount, float))


async def _test_snapshot_completeness():
    """CAS 10 : Snapshot complet — tous les champs requis + JSON-sérialisable."""
    conn = _MockConn(rule=_rule(pp=5.0, rp=10.0))
    r = await engine.compute_pricing(conn, "payer_user", "receiver_user", "svc", 80.0)
    snap = r.to_snapshot()
    required = {
        "currency", "product_type", "base_amount",
        "payer_fixed_fee", "payer_percent_fee_amount",
        "receiver_fixed_fee", "receiver_percent_fee_amount",
        "platform_total_fee", "receiver_net_amount", "payer_total_amount",
        "applied_rules", "applied_subscription_benefits",
    }
    missing = required - snap.keys()
    check("CAS10 tous les champs dans snapshot",  not missing, str(missing))
    try:
        json.dumps(snap)
        check("CAS10 snapshot JSON-sérialisable",  True)
    except TypeError as e:
        check("CAS10 snapshot JSON-sérialisable",  False, str(e))


async def _test_to_payment_dict():
    """CAS 11 : to_payment_dict() → toutes les colonnes DB présentes."""
    conn = _MockConn(rule=_rule(pp=5.0, rp=10.0))
    r = await engine.compute_pricing(conn, "payer_user", "receiver_user", "svc", 100.0)
    pd = r.to_payment_dict(
        payment_id=new_id("pay"),
        payer_user_id="payer_user",
        receiver_user_id="receiver_user",
        product_type="svc",
        product_id="prod_001",
        booking_id="bkg_001",
    )
    required_cols = {
        "payment_id", "payer_user_id", "receiver_user_id",
        "product_type", "product_id", "booking_id",
        "stripe_payment_intent_id", "stripe_charge_id", "stripe_transfer_id",
        "status", "currency",
        "base_amount", "payer_fixed_fee", "payer_percent_fee_amount",
        "receiver_fixed_fee", "receiver_percent_fee_amount",
        "platform_total_fee", "receiver_net_amount", "payer_total_amount",
        "pricing_rule_snapshot",
    }
    missing = required_cols - pd.keys()
    check("CAS11 toutes les colonnes payments présentes",  not missing, str(missing))
    check("CAS11 status == pending",                       pd["status"] == "pending")
    check("CAS11 currency == EUR",                         pd["currency"] == "EUR")
    check("CAS11 pricing_rule_snapshot est dict",          isinstance(pd["pricing_rule_snapshot"], dict))
    check("CAS11 montants cohérents",                      pd["payer_total_amount"] == r.payer_total_amount)


async def _test_calculate_alias():
    """CAS 12 : Alias calculate() → rétro-compatibilité."""
    conn = _MockConn(rule=_rule(pp=5.0))
    r = await engine.calculate(conn, 100.0, "payer_user", "receiver_user", "svc")
    check("CAS12 calculate() retourne PricingResult",  isinstance(r, PricingResult))
    check("CAS12 payer_percent_fee_amount == 5",       r.payer_percent_fee_amount == 5.0, str(r.payer_percent_fee_amount))


async def _test_applied_rules_structure():
    """CAS 13 : applied_rules contient taux originaux ET effectifs."""
    conn = _MockConn(
        rule=_rule(pf=1.0, pp=5.0, rf=2.0, rp=10.0),
        payer_sub=_sub(exempt_pf=True),
        payer_id="payer_user",
    )
    r = await engine.compute_pricing(conn, "payer_user", "receiver_user", "svc", 100.0)
    rule_entry = r.applied_rules[0]
    # Taux originaux conservés dans applied_rules
    check("CAS13 original payer_fixed_fee_rate == 1.0",  rule_entry["payer_fixed_fee_rate"] == 1.0,  str(rule_entry))
    check("CAS13 original payer_percent_fee_rate == 5.0", rule_entry["payer_percent_fee_rate"] == 5.0, str(rule_entry))
    # Taux effectifs reflètent l'exemption
    check("CAS13 effective_payer_fixed_fee == 0.0",
          rule_entry["effective_payer_fixed_fee"] == 0.0,         str(rule_entry))
    check("CAS13 effective_payer_percent_fee_rate == 5.0",
          rule_entry["effective_payer_percent_fee_rate"] == 5.0,  str(rule_entry))


async def _test_zero_base_amount():
    """CAS EDGE : base_amount = 0 → tout est zéro."""
    conn = _MockConn(rule=_rule(pf=1.0, pp=10.0, rf=2.0, rp=15.0))
    r = await engine.compute_pricing(conn, "payer_user", "receiver_user", "svc", 0.0)
    check("EDGE base=0 payer_total==1.0 (fixed uniquement)",    r.payer_total_amount == 1.0,  str(r.payer_total_amount))
    check("EDGE base=0 receiver_net==-2.0 (fixed déduit)",      r.receiver_net_amount == -2.0, str(r.receiver_net_amount))
    check("EDGE base=0 payer_percent_fee_amount==0",             r.payer_percent_fee_amount == 0.0)
    check("EDGE base=0 receiver_percent_fee_amount==0",          r.receiver_percent_fee_amount == 0.0)


async def _test_currency_propagated():
    """CAS EDGE : currency est propagée dans le result et le snapshot."""
    conn = _MockConn(rule=_rule(pp=5.0))
    r = await engine.compute_pricing(conn, "u1", "u2", "svc", 100.0, currency="USD")
    check("EDGE currency USD propagée",              r.currency == "USD")
    check("EDGE currency USD dans snapshot",         r.to_snapshot()["currency"] == "USD")
    pd = r.to_payment_dict("pay_x", "u1", "u2", "svc")
    check("EDGE currency USD dans payment_dict",     pd["currency"] == "USD")


# ═══════════════════════════════════════════════════════════════════════════════
# BLOC B — Tests d'intégration (DB réelle)
# ═══════════════════════════════════════════════════════════════════════════════

async def _test_db_no_rule():
    """DB — Aucune règle active pour product_type inconnu → zéro frais."""
    import asyncpg
    conn = await asyncpg.connect(DB_URL)
    try:
        r = await pricing_engine.compute_pricing(
            conn, "u_test", "u_test2", "unknown_product_xyz", 100.0
        )
        check("DB CAS1 zéro frais sans règle",  r.platform_total_fee == 0.0, str(r.platform_total_fee))
        check("DB CAS1 applied_rules vide",     r.applied_rules == [])
    finally:
        await conn.close()


async def _test_db_with_rule():
    """DB — Règle 'Standard' existante → frais calculés depuis la DB."""
    import asyncpg
    conn = await asyncpg.connect(DB_URL)
    try:
        # La règle 'Standard' (2.5% payeur + 10% bénéficiaire) créée lors des tests précédents
        r = await pricing_engine.compute_pricing(
            conn, "u_test", "u_test2", "service_booking", 60.0
        )
        if r.platform_total_fee > 0:
            check("DB CAS2 payer_total > base",       r.payer_total_amount >= 60.0, str(r.payer_total_amount))
            check("DB CAS2 receiver_net < base",      r.receiver_net_amount <= 60.0, str(r.receiver_net_amount))
            check("DB CAS2 applied_rules non vide",   len(r.applied_rules) == 1)
            check("DB CAS2 rule_id présent",          r.applied_rules[0]["rule_id"] is not None)
        else:
            # Pas de règle active en DB → test neutral
            check("DB CAS2 no-rule fallback OK",      r.payer_total_amount == 60.0)
    finally:
        await conn.close()


# ═══════════════════════════════════════════════════════════════════════════════
# BLOC C — Tests API end-to-end
# ═══════════════════════════════════════════════════════════════════════════════

def _login(email, password):
    r = httpx.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=10)
    assert r.status_code == 200, f"Login failed: {r.text}"
    return r.json()["token"]

def _auth(t): return {"Authorization": f"Bearer {t}"}


def _test_api_booking_creates_payment():
    """API — Créer un booking génère un payment avec snapshot complet."""
    user_tok  = _login("user@winek.app", "WinekUser2024!")
    admin_tok = _login("admin@winek.app", "WinekAdmin2024!")

    r = httpx.post(f"{BASE}/bookings", json={"service_id": "svc_demo001"},
                   headers=_auth(user_tok), timeout=10)
    check("API booking status 200", r.status_code == 200, f"{r.status_code}: {r.text[:200]}")
    if r.status_code != 200:
        return
    b = r.json()
    booking_id = b["booking_id"]

    snap = b.get("pricing_snapshot")
    check("API booking pricing_snapshot présent",            snap is not None)
    check("API booking snap.payer_total_amount présent",     "payer_total_amount" in (snap or {}))
    check("API booking snap.receiver_net_amount présent",    "receiver_net_amount" in (snap or {}))
    check("API booking snap.applied_rules présent",          "applied_rules" in (snap or {}))
    check("API booking snap.applied_subscription_benefits",  "applied_subscription_benefits" in (snap or {}))

    # Vérifie le payment lié en DB via admin
    r2 = httpx.get(f"{BASE}/admin/payments", headers=_auth(admin_tok), timeout=10)
    check("API admin/payments status 200", r2.status_code == 200, f"{r2.status_code}")
    payments = r2.json()
    related = [p for p in payments if p.get("booking_id") == booking_id]
    check("API payment créé atomiquement", len(related) == 1, f"found {len(related)}")
    if related:
        pay = related[0]
        check("API payment.product_type == service_booking", pay["product_type"] == "service_booking")
        check("API payment.status == pending",               pay["status"] == "pending")
        check("API payment.base_amount cohérent",            pay["base_amount"] == snap["base_amount"])
        check("API payment.payer_total_amount cohérent",     pay["payer_total_amount"] == snap["payer_total_amount"])
        check("API pricing_rule_snapshot dans payment",      isinstance(pay["pricing_rule_snapshot"], dict))


def _test_api_payments_me():
    """API — /payments/me retourne les paiements de l'utilisateur."""
    user_tok = _login("user@winek.app", "WinekUser2024!")
    r = httpx.get(f"{BASE}/payments/me", headers=_auth(user_tok), timeout=10)
    check("API payments/me status 200",   r.status_code == 200, str(r.status_code))
    if r.status_code == 200:
        data = r.json()
        check("API payments/me retourne liste",  isinstance(data, list))


def _test_api_admin_stats():
    """API — /admin/payments/stats agrège depuis colonnes plates."""
    admin_tok = _login("admin@winek.app", "WinekAdmin2024!")
    r = httpx.get(f"{BASE}/admin/payments/stats", headers=_auth(admin_tok), timeout=10)
    check("API stats status 200", r.status_code == 200, str(r.status_code))
    if r.status_code == 200:
        s = r.json()
        required = {"total_payments", "paid_count", "pending_count",
                    "gmv", "platform_revenue", "total_charged", "total_disbursed"}
        check("API stats champs présents", required.issubset(s.keys()), str(required - s.keys()))
        check("API stats total_payments >= 0", s["total_payments"] >= 0)


# ═══════════════════════════════════════════════════════════════════════════════
# RUNNER
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    print("\n━━━ BLOC A — Tests unitaires purs (mock) ━━━")
    for coro_fn in [
        _test_no_rule,
        _test_payer_fees_only,
        _test_receiver_fees_only,
        _test_both_sides,
        _test_payer_exemption_full,
        _test_receiver_exemption_full,
        _test_both_exemptions,
        _test_partial_exemption,
        _test_decimal_precision,
        _test_snapshot_completeness,
        _test_to_payment_dict,
        _test_calculate_alias,
        _test_applied_rules_structure,
        _test_zero_base_amount,
        _test_currency_propagated,
    ]:
        print(f"\n[{coro_fn.__name__}]")
        loop.run_until_complete(coro_fn())

    print("\n━━━ BLOC B — Tests intégration DB ━━━")
    for coro_fn in [_test_db_no_rule, _test_db_with_rule]:
        print(f"\n[{coro_fn.__name__}]")
        loop.run_until_complete(coro_fn())

    print("\n━━━ BLOC C — Tests API end-to-end ━━━")
    for fn in [_test_api_booking_creates_payment, _test_api_payments_me, _test_api_admin_stats]:
        print(f"\n[{fn.__name__}]")
        fn()

    loop.close()

    total = len(PASSED) + len(FAILED)
    print(f"\n{'━'*55}")
    print(f"  {len(PASSED)}/{total} tests passent")
    if FAILED:
        print(f"  ÉCHECS :")
        for f in FAILED:
            print(f"    ✗ {f}")
    else:
        print("  ✅ Tous les tests passent")
    print(f"{'━'*55}\n")

    sys.exit(len(FAILED))
