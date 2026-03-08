"""
pricing_engine.py — Moteur de pricing centralisé SpotU
=======================================================
Toute logique de frais/commission passe UNIQUEMENT par ce module.
Aucune route ne doit hardcoder un taux ou un montant de frais.

Concepts :
  base_amount         — montant brut du produit/service
  payer_fixed_fee     — frais fixe ajouté côté payeur
  payer_percent_fee   — frais % ajouté côté payeur (calculé sur base_amount)
  receiver_fixed_fee  — frais fixe déduit côté bénéficiaire
  receiver_percent_fee— frais % déduit côté bénéficiaire (calculé sur base_amount)
  payer_total_amount  — ce que paie réellement le payeur
  receiver_net_amount — ce que reçoit réellement le bénéficiaire
  platform_total_fee  — somme de tous les frais encaissés par la plateforme

Les abonnements actifs peuvent exempter certains frais partiellement ou totalement.
Chaque calcul retourne un PricingResult qui doit être stocké en snapshot JSONB
sur la transaction — il est la source de vérité immuable des conditions appliquées.
"""

from dataclasses import dataclass, asdict
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional


@dataclass
class PricingResult:
    base_amount: float
    payer_fixed_fee: float
    payer_percent_fee: float
    receiver_fixed_fee: float
    receiver_percent_fee: float
    platform_total_fee: float
    receiver_net_amount: float
    payer_total_amount: float
    rule_id: Optional[str]
    rule_name: Optional[str]
    product_type: str
    subscription_exemptions: list  # liste des exemptions appliquées

    def to_snapshot(self) -> dict:
        """Sérialise le résultat pour stockage JSONB immuable sur la transaction."""
        return asdict(self)


class PricingEngine:
    """
    Moteur de calcul de frais.
    Usage : await pricing_engine.calculate(conn, base_amount, payer_id, receiver_id, product_type)
    """

    async def calculate(
        self,
        conn,
        base_amount: float,
        payer_user_id: str,
        receiver_user_id: str,
        product_type: str,
    ) -> PricingResult:
        """
        Calcule les frais applicables à une transaction.

        Args:
            conn          : connexion asyncpg (dans une transaction existante ou non)
            base_amount   : montant brut du produit
            payer_user_id : ID de l'utilisateur qui paie
            receiver_user_id : ID de l'utilisateur qui reçoit
            product_type  : type de produit ('service_booking', 'subscription', ...)

        Returns:
            PricingResult avec tous les montants détaillés
        """
        # 1. Charger la règle active pour ce product_type
        rule = await conn.fetchrow(
            """
            SELECT rule_id, name, payer_fixed_fee, payer_percent_fee,
                   receiver_fixed_fee, receiver_percent_fee
            FROM pricing_rules
            WHERE product_type = $1 AND active = TRUE
            ORDER BY priority DESC, created_at DESC
            LIMIT 1
            """,
            product_type,
        )

        if not rule:
            # Pas de règle = transaction gratuite pour la plateforme
            return PricingResult(
                base_amount=float(base_amount),
                payer_fixed_fee=0.0,
                payer_percent_fee=0.0,
                receiver_fixed_fee=0.0,
                receiver_percent_fee=0.0,
                platform_total_fee=0.0,
                receiver_net_amount=float(base_amount),
                payer_total_amount=float(base_amount),
                rule_id=None,
                rule_name=None,
                product_type=product_type,
                subscription_exemptions=[],
            )

        r = dict(rule)
        payer_fixed = Decimal(str(r["payer_fixed_fee"]))
        payer_pct = Decimal(str(r["payer_percent_fee"]))
        receiver_fixed = Decimal(str(r["receiver_fixed_fee"]))
        receiver_pct = Decimal(str(r["receiver_percent_fee"]))
        exemptions = []

        # 2. Exemptions côté payeur via abonnement actif
        payer_sub = await conn.fetchrow(
            """
            SELECT sp.exempt_payer_fixed, sp.exempt_payer_percent
            FROM user_subscriptions us
            JOIN subscription_plans sp ON sp.plan_id = us.plan_id
            WHERE us.user_id = $1
              AND us.status = 'active'
              AND (us.expires_at IS NULL OR us.expires_at > NOW())
            ORDER BY sp.priority DESC, us.started_at DESC
            LIMIT 1
            """,
            payer_user_id,
        )
        if payer_sub:
            ps = dict(payer_sub)
            if ps["exempt_payer_fixed"]:
                payer_fixed = Decimal("0")
                exemptions.append("payer_fixed_fee_exempted")
            if ps["exempt_payer_percent"]:
                payer_pct = Decimal("0")
                exemptions.append("payer_percent_fee_exempted")

        # 3. Exemptions côté bénéficiaire via abonnement actif
        receiver_sub = await conn.fetchrow(
            """
            SELECT sp.exempt_receiver_fixed, sp.exempt_receiver_percent
            FROM user_subscriptions us
            JOIN subscription_plans sp ON sp.plan_id = us.plan_id
            WHERE us.user_id = $1
              AND us.status = 'active'
              AND (us.expires_at IS NULL OR us.expires_at > NOW())
            ORDER BY sp.priority DESC, us.started_at DESC
            LIMIT 1
            """,
            receiver_user_id,
        )
        if receiver_sub:
            rs = dict(receiver_sub)
            if rs["exempt_receiver_fixed"]:
                receiver_fixed = Decimal("0")
                exemptions.append("receiver_fixed_fee_exempted")
            if rs["exempt_receiver_percent"]:
                receiver_pct = Decimal("0")
                exemptions.append("receiver_percent_fee_exempted")

        # 4. Calcul avec Decimal pour éviter les erreurs d'arrondi flottant
        b = Decimal(str(base_amount)).quantize(Decimal("0.01"), ROUND_HALF_UP)

        pf = payer_fixed.quantize(Decimal("0.01"), ROUND_HALF_UP)
        pp = (b * payer_pct / 100).quantize(Decimal("0.01"), ROUND_HALF_UP)

        rf = receiver_fixed.quantize(Decimal("0.01"), ROUND_HALF_UP)
        rp = (b * receiver_pct / 100).quantize(Decimal("0.01"), ROUND_HALF_UP)

        payer_total = (b + pf + pp).quantize(Decimal("0.01"), ROUND_HALF_UP)
        receiver_net = (b - rf - rp).quantize(Decimal("0.01"), ROUND_HALF_UP)
        platform_total = (pf + pp + rf + rp).quantize(Decimal("0.01"), ROUND_HALF_UP)

        return PricingResult(
            base_amount=float(b),
            payer_fixed_fee=float(pf),
            payer_percent_fee=float(pp),
            receiver_fixed_fee=float(rf),
            receiver_percent_fee=float(rp),
            platform_total_fee=float(platform_total),
            receiver_net_amount=float(receiver_net),
            payer_total_amount=float(payer_total),
            rule_id=r["rule_id"],
            rule_name=r["name"],
            product_type=product_type,
            subscription_exemptions=exemptions,
        )


# Singleton — importé dans toutes les routes qui en ont besoin
pricing_engine = PricingEngine()
