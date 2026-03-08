"""
pricing_engine.py — Moteur de pricing centralisé SpotU
=======================================================
Point d'entrée unique pour tout calcul de frais/commission.
Aucune route ne doit hardcoder un taux ou calculer des montants de frais.

API publique :
    result = await pricing_engine.compute_pricing(
        conn, payer_user_id, receiver_user_id,
        product_type, base_amount, currency="EUR", **context
    )

Champs retournés (PricingResult) :
    currency                   — devise de la transaction
    product_type               — type produit scopé
    base_amount                — montant brut avant frais
    payer_fixed_fee            — frais fixe ajouté côté payeur
    payer_percent_fee_amount   — frais % calculé côté payeur (montant, pas taux)
    receiver_fixed_fee         — frais fixe déduit côté bénéficiaire
    receiver_percent_fee_amount— frais % calculé côté bénéficiaire (montant, pas taux)
    platform_total_fee         — total encaissé par la plateforme
    receiver_net_amount        — ce que reçoit réellement le bénéficiaire
    payer_total_amount         — ce que paie réellement le payeur
    applied_rules              — règles tarifaires appliquées (taux d'origine + effectifs)
    applied_subscription_benefits — exemptions appliquées par abonnement actif
"""

from dataclasses import dataclass, asdict, field
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional


# ── Dataclass résultat ─────────────────────────────────────────────────────────

@dataclass
class PricingResult:
    # Identification
    currency: str
    product_type: str

    # Montants
    base_amount: float
    payer_fixed_fee: float
    payer_percent_fee_amount: float       # montant calculé (pas le taux)
    receiver_fixed_fee: float
    receiver_percent_fee_amount: float    # montant calculé (pas le taux)
    platform_total_fee: float
    receiver_net_amount: float
    payer_total_amount: float

    # Audit — source de vérité des conditions appliquées
    applied_rules: list = field(default_factory=list)
    applied_subscription_benefits: list = field(default_factory=list)

    def to_snapshot(self) -> dict:
        """
        Sérialise le résultat complet pour stockage JSONB immuable.
        Le snapshot est la source de vérité de la transaction — ne pas recalculer.
        """
        return asdict(self)

    def to_payment_dict(
        self,
        payment_id: str,
        payer_user_id: str,
        receiver_user_id: str,
        product_type: str,
        product_id: Optional[str] = None,
        booking_id: Optional[str] = None,
    ) -> dict:
        """
        Retourne un dict prêt à être inséré dans la table `payments`.
        Les colonnes plates correspondent exactement au schéma DB.
        Le snapshot JSONB (pricing_rule_snapshot) est inclus.
        """
        return {
            "payment_id":                  payment_id,
            "payer_user_id":               payer_user_id,
            "receiver_user_id":            receiver_user_id,
            "product_type":                product_type,
            "product_id":                  product_id,
            "booking_id":                  booking_id,
            "stripe_payment_intent_id":    None,
            "stripe_charge_id":            None,
            "stripe_transfer_id":          None,
            "status":                      "pending",
            "currency":                    self.currency,
            "base_amount":                 self.base_amount,
            "payer_fixed_fee":             self.payer_fixed_fee,
            "payer_percent_fee_amount":    self.payer_percent_fee_amount,
            "receiver_fixed_fee":          self.receiver_fixed_fee,
            "receiver_percent_fee_amount": self.receiver_percent_fee_amount,
            "platform_total_fee":          self.platform_total_fee,
            "receiver_net_amount":         self.receiver_net_amount,
            "payer_total_amount":          self.payer_total_amount,
            "pricing_rule_snapshot":       self.to_snapshot(),
        }


# ── Résolution des bénéfices d'abonnement ─────────────────────────────────────

async def _load_subscription_benefits(conn, user_id: str) -> dict:
    """
    Charge l'abonnement actif d'un utilisateur et retourne ses bénéfices.

    Couche dédiée, indépendante de la logique de calcul de frais.
    Appelée séparément pour le payeur et le bénéficiaire.

    Règles :
    - Seul l'abonnement actif (status='active') non expiré est considéré.
    - Si un plan est désactivé (active=FALSE) mais que l'abonnement est encore
      valide (expires_at > NOW()), les bénéfices sont conservés.
    - En cas de plusieurs abonnements actifs, le plus prioritaire est retenu.

    Returns:
        dict avec les clés :
            plan_id, plan_name,
            exempt_payer_fixed, exempt_payer_percent,
            exempt_receiver_fixed, exempt_receiver_percent
        ou {} si aucun abonnement actif.
    """
    row = await conn.fetchrow(
        """
        SELECT
            sp.plan_id,
            sp.name                AS plan_name,
            sp.exempt_payer_fixed,
            sp.exempt_payer_percent,
            sp.exempt_receiver_fixed,
            sp.exempt_receiver_percent
        FROM user_subscriptions us
        JOIN subscription_plans sp ON sp.plan_id = us.plan_id
        WHERE us.user_id = $1
          AND us.status IN ('active', 'cancelling')
          AND (us.expires_at IS NULL OR us.expires_at > NOW())
        ORDER BY sp.priority DESC, us.started_at DESC
        LIMIT 1
        """,
        user_id,
    )
    return dict(row) if row else {}


# ── Moteur ─────────────────────────────────────────────────────────────────────

class PricingEngine:
    """
    Moteur de calcul de frais. Instancié en singleton (`pricing_engine`).

    Toute la logique de frais est ici — les routes ne calculent rien.
    Compatible avec n'importe quelle paire (payeur, bénéficiaire) sans dépendance
    aux rôles métier (coach/client/etc.).
    """

    async def compute_pricing(
        self,
        conn,
        payer_user_id: str,
        receiver_user_id: str,
        product_type: str,
        base_amount: float,
        currency: str = "EUR",
        **context,
    ) -> PricingResult:
        """
        Calcule les frais applicables à une transaction.

        Args:
            conn             : connexion asyncpg (dans une transaction ou non)
            payer_user_id    : ID générique de l'utilisateur qui paie
            receiver_user_id : ID générique de l'utilisateur qui reçoit
            product_type     : scope tarifaire ('service_booking', 'subscription', ...)
            base_amount      : montant brut du produit, avant tout frais
            currency         : devise ISO 4217 (défaut: EUR)
            **context        : contexte extensible (discount_code, is_first_transaction...)

        Returns:
            PricingResult avec tous les montants détaillés + audit complet
        """

        # ── 1. Règle tarifaire active ──────────────────────────────────────────
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

        # Cas : aucune règle → transaction sans frais
        if not rule:
            return PricingResult(
                currency=currency,
                product_type=product_type,
                base_amount=round(float(base_amount), 2),
                payer_fixed_fee=0.0,
                payer_percent_fee_amount=0.0,
                receiver_fixed_fee=0.0,
                receiver_percent_fee_amount=0.0,
                platform_total_fee=0.0,
                receiver_net_amount=round(float(base_amount), 2),
                payer_total_amount=round(float(base_amount), 2),
                applied_rules=[],
                applied_subscription_benefits=[],
            )

        r = dict(rule)
        # Taux originaux (avant exemptions) — conservés pour l'audit
        orig_payer_fixed    = Decimal(str(r["payer_fixed_fee"]))
        orig_payer_pct      = Decimal(str(r["payer_percent_fee"]))
        orig_receiver_fixed = Decimal(str(r["receiver_fixed_fee"]))
        orig_receiver_pct   = Decimal(str(r["receiver_percent_fee"]))

        # Taux effectifs — modifiables par les exemptions d'abonnement
        eff_payer_fixed    = orig_payer_fixed
        eff_payer_pct      = orig_payer_pct
        eff_receiver_fixed = orig_receiver_fixed
        eff_receiver_pct   = orig_receiver_pct

        subscription_benefits = []

        # ── 2. Bénéfices abonnement payeur ────────────────────────────────────
        payer_benefits = await _load_subscription_benefits(conn, payer_user_id)
        if payer_benefits:
            exempted = []
            if payer_benefits.get("exempt_payer_fixed") and eff_payer_fixed > 0:
                eff_payer_fixed = Decimal("0")
                exempted.append("payer_fixed_fee")
            if payer_benefits.get("exempt_payer_percent") and eff_payer_pct > 0:
                eff_payer_pct = Decimal("0")
                exempted.append("payer_percent_fee")
            if exempted:
                subscription_benefits.append({
                    "side":            "payer",
                    "user_id":         payer_user_id,
                    "plan_id":         payer_benefits["plan_id"],
                    "plan_name":       payer_benefits.get("plan_name"),
                    "exempted_fields": exempted,
                })

        # ── 3. Bénéfices abonnement bénéficiaire ──────────────────────────────
        receiver_benefits = await _load_subscription_benefits(conn, receiver_user_id)
        if receiver_benefits:
            exempted = []
            if receiver_benefits.get("exempt_receiver_fixed") and eff_receiver_fixed > 0:
                eff_receiver_fixed = Decimal("0")
                exempted.append("receiver_fixed_fee")
            if receiver_benefits.get("exempt_receiver_percent") and eff_receiver_pct > 0:
                eff_receiver_pct = Decimal("0")
                exempted.append("receiver_percent_fee")
            if exempted:
                subscription_benefits.append({
                    "side":            "receiver",
                    "user_id":         receiver_user_id,
                    "plan_id":         receiver_benefits["plan_id"],
                    "plan_name":       receiver_benefits.get("plan_name"),
                    "exempted_fields": exempted,
                })

        # ── 4. Calcul Decimal (précision financière) ───────────────────────────
        b   = Decimal(str(base_amount)).quantize(Decimal("0.01"), ROUND_HALF_UP)
        pf  = eff_payer_fixed.quantize(Decimal("0.01"), ROUND_HALF_UP)
        pp  = (b * eff_payer_pct / 100).quantize(Decimal("0.01"), ROUND_HALF_UP)
        rf  = eff_receiver_fixed.quantize(Decimal("0.01"), ROUND_HALF_UP)
        rp  = (b * eff_receiver_pct / 100).quantize(Decimal("0.01"), ROUND_HALF_UP)

        payer_total    = (b + pf + pp).quantize(Decimal("0.01"), ROUND_HALF_UP)
        receiver_net   = (b - rf - rp).quantize(Decimal("0.01"), ROUND_HALF_UP)
        platform_total = (pf + pp + rf + rp).quantize(Decimal("0.01"), ROUND_HALF_UP)

        # ── 5. Audit complet (taux originaux + effectifs + impact) ────────────
        applied_rule = {
            "rule_id":   r["rule_id"],
            "rule_name": r["name"],
            "product_type": product_type,
            # Taux originaux configurés en DB
            "payer_fixed_fee_rate":        float(orig_payer_fixed),
            "payer_percent_fee_rate":      float(orig_payer_pct),
            "receiver_fixed_fee_rate":     float(orig_receiver_fixed),
            "receiver_percent_fee_rate":   float(orig_receiver_pct),
            # Taux effectivement appliqués (après exemptions)
            "effective_payer_fixed_fee":          float(pf),
            "effective_payer_percent_fee_rate":   float(eff_payer_pct),
            "effective_receiver_fixed_fee":       float(rf),
            "effective_receiver_percent_fee_rate": float(eff_receiver_pct),
            # Impact financier des exemptions
            "savings_payer":    float(
                (orig_payer_fixed - pf) + (b * orig_payer_pct / 100 - pp)
            ),
            "savings_receiver": float(
                (orig_receiver_fixed - rf) + (b * orig_receiver_pct / 100 - rp)
            ),
        }

        return PricingResult(
            currency=currency,
            product_type=product_type,
            base_amount=float(b),
            payer_fixed_fee=float(pf),
            payer_percent_fee_amount=float(pp),
            receiver_fixed_fee=float(rf),
            receiver_percent_fee_amount=float(rp),
            platform_total_fee=float(platform_total),
            receiver_net_amount=float(receiver_net),
            payer_total_amount=float(payer_total),
            applied_rules=[applied_rule],
            applied_subscription_benefits=subscription_benefits,
        )

    # ── Alias rétro-compatible ─────────────────────────────────────────────────
    async def calculate(
        self,
        conn,
        base_amount: float,
        payer_user_id: str,
        receiver_user_id: str,
        product_type: str,
        currency: str = "EUR",
    ) -> PricingResult:
        """
        Alias rétro-compatible → délègue à compute_pricing().
        Préférer compute_pricing() pour tout nouveau code.
        """
        return await self.compute_pricing(
            conn=conn,
            payer_user_id=payer_user_id,
            receiver_user_id=receiver_user_id,
            product_type=product_type,
            base_amount=base_amount,
            currency=currency,
        )


# Singleton — importé dans toutes les routes qui en ont besoin
pricing_engine = PricingEngine()
