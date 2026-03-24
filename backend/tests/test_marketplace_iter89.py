"""
test_marketplace_iter89.py — Tests Vue Détail Produit : seller_stats enrichis
==============================================================================
Nouveaux tests pour l'itération 89 :
1. GET /api/marketplace/products — seller_stats présents sur chaque item
2. GET /api/marketplace/products?spotyou_id=pt_demo009 — 12 items avec seller_stats
3. Chaque seller_stats contient rating_avg, rating_count, products_count, services_count, spotyou_count
4. rating_avg peut être None (table reviews vide — normal)
5. seller_stats enrichis pour les services (coach_id) ET les produits (seller_id)
6. owner items (badge_type=owner) ont des seller_stats non-nuls
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

REQUIRED_SELLER_STATS_KEYS = [
    "rating_avg",
    "rating_count",
    "products_count",
    "services_count",
    "spotyou_count",
]


class TestSellerStatsEnrichment:
    """Tests pour la présence et la structure des seller_stats."""

    def test_seller_stats_present_unfiltered(self):
        """GET /api/marketplace/products — seller_stats doit être présent sur chaque produit."""
        r = requests.get(f"{BASE_URL}/api/marketplace/products", timeout=15)
        assert r.status_code == 200, f"HTTP {r.status_code}: {r.text[:200]}"
        data = r.json()
        products = data.get("products", [])
        assert len(products) > 0, "Aucun produit retourné"

        for p in products:
            assert "seller_stats" in p, (
                f"seller_stats manquant pour {p.get('product_id') or p.get('service_id')}"
            )
        print(f"PASS: seller_stats présent sur {len(products)} produits")

    def test_seller_stats_keys_complete(self):
        """Chaque seller_stats contient exactement les 5 clés requises."""
        r = requests.get(f"{BASE_URL}/api/marketplace/products", timeout=15)
        assert r.status_code == 200
        products = r.json().get("products", [])

        for p in products:
            ss = p.get("seller_stats", {})
            missing = [k for k in REQUIRED_SELLER_STATS_KEYS if k not in ss]
            assert not missing, (
                f"Clés manquantes dans seller_stats de '{p.get('product_id') or p.get('service_id')}': {missing}"
            )
        print(f"PASS: Toutes les 5 clés seller_stats présentes sur {len(products)} items")

    def test_seller_stats_rating_avg_can_be_none(self):
        """rating_avg peut être None (aucun avis pour l'instant) — ne doit pas causer d'erreur."""
        r = requests.get(f"{BASE_URL}/api/marketplace/products", timeout=15)
        assert r.status_code == 200
        products = r.json().get("products", [])

        for p in products:
            ss = p.get("seller_stats", {})
            rating_avg = ss.get("rating_avg")
            # rating_avg est None ou un float — les deux sont valides
            assert rating_avg is None or isinstance(rating_avg, (int, float)), (
                f"rating_avg type invalide: {type(rating_avg)} pour {p.get('product_id')}"
            )
        print(f"PASS: rating_avg None ou float sur {len(products)} items")

    def test_seller_stats_counts_are_integers(self):
        """rating_count, products_count, services_count, spotyou_count doivent être des entiers >= 0."""
        r = requests.get(f"{BASE_URL}/api/marketplace/products", timeout=15)
        assert r.status_code == 200
        products = r.json().get("products", [])

        count_keys = ["rating_count", "products_count", "services_count", "spotyou_count"]
        for p in products:
            ss = p.get("seller_stats", {})
            for k in count_keys:
                val = ss.get(k)
                assert isinstance(val, int) and val >= 0, (
                    f"'{k}' invalide ({val}) pour {p.get('product_id') or p.get('service_id')}"
                )
        print(f"PASS: Tous les compteurs seller_stats sont des entiers >= 0")


class TestSellerStatsPtDemo009:
    """Tests seller_stats pour pt_demo009 (SpotYou avec tags trail/10k, 11 produits + 1 service)."""

    def test_pt_demo009_returns_12_items(self):
        """GET ?spotyou_id=pt_demo009 doit retourner 12 items (11 produits + 1 service)."""
        r = requests.get(
            f"{BASE_URL}/api/marketplace/products",
            params={"spotyou_id": "pt_demo009"},
            timeout=15,
        )
        assert r.status_code == 200, f"HTTP {r.status_code}: {r.text[:200]}"
        data = r.json()
        count = data.get("count", -1)
        products = data.get("products", [])
        assert count == 12, f"Attendu 12 items pour pt_demo009, reçu {count}"
        assert len(products) == 12
        print(f"PASS: pt_demo009 retourne {count} items")

    def test_pt_demo009_seller_stats_on_all_items(self):
        """Chaque item de pt_demo009 doit avoir seller_stats avec les 5 clés."""
        r = requests.get(
            f"{BASE_URL}/api/marketplace/products",
            params={"spotyou_id": "pt_demo009"},
            timeout=15,
        )
        assert r.status_code == 200
        products = r.json().get("products", [])
        assert len(products) > 0

        for p in products:
            ss = p.get("seller_stats", {})
            missing = [k for k in REQUIRED_SELLER_STATS_KEYS if k not in ss]
            assert not missing, (
                f"seller_stats incomplet pour {p.get('product_id') or p.get('service_id')}: {missing}"
            )
        print(f"PASS: seller_stats complets sur {len(products)} items de pt_demo009")

    def test_pt_demo009_owner_items_have_non_zero_stats(self):
        """Les items badge_type=owner (Sophie Martin / user_coach001) doivent avoir des compteurs > 0."""
        r = requests.get(
            f"{BASE_URL}/api/marketplace/products",
            params={"spotyou_id": "pt_demo009"},
            timeout=15,
        )
        assert r.status_code == 200
        products = r.json().get("products", [])
        owner_items = [p for p in products if p.get("badge_type") == "owner"]
        assert len(owner_items) > 0, "Aucun item owner trouvé pour pt_demo009"

        for p in owner_items:
            ss = p.get("seller_stats", {})
            # Au moins un compteur doit être > 0 (le créateur a des produits)
            has_content = (
                ss.get("products_count", 0) > 0
                or ss.get("services_count", 0) > 0
                or ss.get("spotyou_count", 0) > 0
            )
            assert has_content, (
                f"Item owner sans contenu dans seller_stats: {ss} pour {p.get('product_id')}"
            )
        print(f"PASS: {len(owner_items)} items owner ont des seller_stats non-nuls")

    def test_pt_demo009_has_service_item(self):
        """pt_demo009 doit inclure au moins 1 service (item_type=service) avec seller_stats."""
        r = requests.get(
            f"{BASE_URL}/api/marketplace/products",
            params={"spotyou_id": "pt_demo009"},
            timeout=15,
        )
        assert r.status_code == 200
        products = r.json().get("products", [])
        services = [p for p in products if p.get("item_type") == "service"]
        assert len(services) >= 1, f"Aucun service trouvé pour pt_demo009"

        for svc in services:
            assert "seller_stats" in svc, "seller_stats manquant sur le service"
            ss = svc["seller_stats"]
            missing = [k for k in REQUIRED_SELLER_STATS_KEYS if k not in ss]
            assert not missing, f"seller_stats incomplet sur service: {missing}"
        print(f"PASS: {len(services)} service(s) avec seller_stats pour pt_demo009")

    def test_pt_demo009_owner_first_order(self):
        """Les items owner (badge_type=owner) doivent apparaître en premier dans la liste."""
        r = requests.get(
            f"{BASE_URL}/api/marketplace/products",
            params={"spotyou_id": "pt_demo009"},
            timeout=15,
        )
        assert r.status_code == 200
        products = r.json().get("products", [])
        if len(products) < 2:
            pytest.skip("Pas assez d'items pour tester l'ordre")

        # Trouver la dernière position d'un item owner et la première position d'un item non-owner
        last_owner_idx = -1
        first_non_owner_idx = len(products)
        for i, p in enumerate(products):
            if p.get("badge_type") == "owner":
                last_owner_idx = i
            else:
                first_non_owner_idx = min(first_non_owner_idx, i)

        if last_owner_idx == -1 or first_non_owner_idx == len(products):
            pytest.skip("Pas suffisamment de diversité badge_type pour tester l'ordre")

        assert last_owner_idx < first_non_owner_idx, (
            f"Items owner pas en premier: dernier owner idx={last_owner_idx}, "
            f"premier non-owner idx={first_non_owner_idx}"
        )
        print(f"PASS: Items owner (jusqu'à idx={last_owner_idx}) avant non-owner (dès idx={first_non_owner_idx})")

    def test_pt_demo009_badge_types_present(self):
        """Les items doivent avoir badge_type (owner ou other) et badge_label."""
        r = requests.get(
            f"{BASE_URL}/api/marketplace/products",
            params={"spotyou_id": "pt_demo009"},
            timeout=15,
        )
        assert r.status_code == 200
        products = r.json().get("products", [])

        for p in products:
            assert "badge_type" in p, f"badge_type manquant pour {p.get('product_id')}"
            assert p["badge_type"] in ("owner", "other"), (
                f"badge_type invalide: {p['badge_type']}"
            )
            assert "badge_label" in p, f"badge_label manquant pour {p.get('product_id')}"
        print(f"PASS: badge_type et badge_label présents sur {len(products)} items")


class TestSellerStatsEdgeCases:
    """Tests des cas limites pour seller_stats."""

    def test_seller_stats_no_500_error(self):
        """Le calcul des seller_stats ne doit pas provoquer d'erreur 500."""
        r = requests.get(f"{BASE_URL}/api/marketplace/products", timeout=15)
        assert r.status_code != 500, f"Erreur 500 inattendue: {r.text[:300]}"
        assert r.status_code == 200
        print("PASS: Pas d'erreur 500 sur /api/marketplace/products")

    def test_seller_stats_invalid_spotyou_no_500(self):
        """Même avec un spotyou_id invalide, seller_stats ne doit pas lever d'exception."""
        r = requests.get(
            f"{BASE_URL}/api/marketplace/products",
            params={"spotyou_id": "INVALID_SPOTYOU_ID_TEST"},
            timeout=15,
        )
        assert r.status_code == 200, f"HTTP {r.status_code}: {r.text[:200]}"
        data = r.json()
        assert data["count"] == 0, f"Attendu 0 item, reçu {data['count']}"
        print("PASS: INVALID_SPOTYOU_ID retourne 0 item sans erreur")

    def test_seller_stats_with_tag_filter(self):
        """GET ?tag_ids=tag_trail,tag_10k — seller_stats présents sur les résultats filtrés."""
        r = requests.get(
            f"{BASE_URL}/api/marketplace/products",
            params={"tag_ids": "tag_trail,tag_10k"},
            timeout=15,
        )
        assert r.status_code == 200
        products = r.json().get("products", [])

        for p in products:
            assert "seller_stats" in p, (
                f"seller_stats manquant sur item filtré {p.get('product_id') or p.get('service_id')}"
            )
            ss = p["seller_stats"]
            missing = [k for k in REQUIRED_SELLER_STATS_KEYS if k not in ss]
            assert not missing, f"Clés manquantes: {missing}"
        print(f"PASS: seller_stats présents sur {len(products)} items avec tag_trail,tag_10k")
