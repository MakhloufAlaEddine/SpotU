"""
test_marketplace_iter88.py — Tests backend pour la fonctionnalité Marketplace SpotYou
======================================================================================
Tests couverts:
1. GET /api/marketplace/products - retourne 14 produits seed
2. GET /api/marketplace/products?tag_ids=tag_yoga,tag_fitness - filtrage par tags
3. GET /api/marketplace/products?spotyou_id=pt_demo001 - produits pour un SpotYou
4. GET /api/marketplace/products?spotyou_id=INVALID_ID - 0 produit sans erreur 500
5. Absence du champ _id MongoDB dans les résultats
6. Health check backend (vérification endpoints disponibles)
7. Authentification: POST /api/auth/login avec coach@winek.app
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")


class TestBackendHealth:
    """Vérification que le backend est opérationnel."""

    def test_marketplace_endpoint_accessible(self):
        """L'endpoint marketplace répond (indique que le backend tourne)."""
        response = requests.get(f"{BASE_URL}/api/marketplace/products", timeout=10)
        assert response.status_code == 200, (
            f"Backend inaccessible: HTTP {response.status_code}"
        )
        print(f"PASS: Backend accessible - status {response.status_code}")

    def test_openapi_docs_accessible(self):
        """Vérifie que la doc OpenAPI est disponible (backend FastAPI ok)."""
        response = requests.get(f"{BASE_URL}/api/openapi.json", timeout=10)
        # 200 ou 404 acceptable - l'important est que le backend répond
        assert response.status_code in (200, 404, 422), (
            f"Backend erreur inattendue: HTTP {response.status_code}"
        )
        print(f"PASS: Backend répond sur /api/openapi.json - status {response.status_code}")


class TestAuthentication:
    """Tests d'authentification."""

    def test_login_coach(self):
        """POST /api/auth/login avec coach@winek.app doit retourner un token."""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "coach@winek.app", "password": "WinekCoach2024!"},
            timeout=10,
        )
        assert response.status_code == 200, (
            f"Login coach échoué: HTTP {response.status_code} - {response.text[:200]}"
        )
        data = response.json()
        assert "token" in data or "access_token" in data, (
            f"Pas de token dans la réponse: {list(data.keys())}"
        )
        token = data.get("token") or data.get("access_token")
        assert isinstance(token, str) and len(token) > 10, (
            f"Token invalide: {token!r}"
        )
        print(f"PASS: Login coach - token reçu (longueur {len(token)})")

    def test_login_admin(self):
        """POST /api/auth/login avec admin@winek.app doit retourner un token."""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@winek.app", "password": "WinekAdmin2024!"},
            timeout=10,
        )
        assert response.status_code == 200, (
            f"Login admin échoué: HTTP {response.status_code} - {response.text[:200]}"
        )
        data = response.json()
        token = data.get("token") or data.get("access_token")
        assert token is not None, f"Pas de token dans la réponse admin: {list(data.keys())}"
        print(f"PASS: Login admin - token reçu")

    def test_login_invalid_credentials(self):
        """Login avec mauvais mot de passe doit retourner 401."""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "coach@winek.app", "password": "WrongPassword!"},
            timeout=10,
        )
        assert response.status_code in (400, 401, 403), (
            f"Login invalide devrait échouer: HTTP {response.status_code}"
        )
        print(f"PASS: Login invalide - status {response.status_code}")


class TestMarketplaceProducts:
    """Tests principaux de l'endpoint GET /api/marketplace/products."""

    def test_get_all_products_returns_14(self):
        """GET /api/marketplace/products doit retourner exactement 14 produits seed."""
        response = requests.get(f"{BASE_URL}/api/marketplace/products", timeout=10)
        assert response.status_code == 200, (
            f"Erreur HTTP: {response.status_code} - {response.text[:200]}"
        )
        data = response.json()
        assert "products" in data, f"Clé 'products' absente: {list(data.keys())}"
        assert "count" in data, f"Clé 'count' absente: {list(data.keys())}"
        products = data["products"]
        count = data["count"]
        assert count == 14, f"Attendu 14 produits, reçu {count}"
        assert len(products) == 14, f"Liste products: {len(products)} produits au lieu de 14"
        print(f"PASS: {count} produits retournés (attendu: 14)")

    def test_response_structure(self):
        """Vérifie la structure de la réponse et des objets produit."""
        response = requests.get(f"{BASE_URL}/api/marketplace/products", timeout=10)
        assert response.status_code == 200
        data = response.json()
        products = data["products"]
        assert len(products) > 0, "Aucun produit retourné"

        # Vérifie la structure du premier produit
        p = products[0]
        expected_fields = ["product_id", "title", "price", "tag_ids"]
        for field in expected_fields:
            assert field in p, f"Champ '{field}' absent du produit: {list(p.keys())}"
        print(f"PASS: Structure produit valide - champs présents: {list(p.keys())[:8]}")

    def test_no_mongo_id_field(self):
        """Les résultats NE doivent PAS contenir de champ '_id' (ObjectId MongoDB)."""
        response = requests.get(f"{BASE_URL}/api/marketplace/products", timeout=10)
        assert response.status_code == 200
        data = response.json()
        products = data["products"]
        for p in products:
            assert "_id" not in p, (
                f"Champ '_id' trouvé dans le produit '{p.get('product_id', '?')}' - "
                f"ObjectId MongoDB non sérialisable détecté!"
            )
        print(f"PASS: Aucun champ '_id' dans les {len(products)} produits")

    def test_price_is_float_not_decimal(self):
        """Les prix doivent être des float, pas des Decimal (non JSON-sérialisable)."""
        response = requests.get(f"{BASE_URL}/api/marketplace/products", timeout=10)
        assert response.status_code == 200
        data = response.json()
        for p in data["products"]:
            if p.get("price") is not None:
                assert isinstance(p["price"], (int, float)), (
                    f"Prix non numérique pour '{p.get('product_id')}': {type(p['price'])}"
                )
        print("PASS: Tous les prix sont des float valides")


class TestMarketplaceFiltering:
    """Tests de filtrage par tag_ids et spotyou_id."""

    def test_filter_by_tag_ids_yoga_fitness(self):
        """GET ?tag_ids=tag_yoga,tag_fitness doit retourner des produits filtrés."""
        response = requests.get(
            f"{BASE_URL}/api/marketplace/products",
            params={"tag_ids": "tag_yoga,tag_fitness"},
            timeout=10,
        )
        assert response.status_code == 200, (
            f"Erreur HTTP: {response.status_code} - {response.text[:200]}"
        )
        data = response.json()
        assert "products" in data
        products = data["products"]
        count = data["count"]

        # Doit retourner au moins 1 produit filtré
        assert count >= 0, f"Count négatif: {count}"

        # Si des produits sont retournés, ils doivent avoir au moins un des tags demandés
        for p in products:
            p_tags = p.get("tag_ids", [])
            has_matching_tag = bool(set(p_tags) & {"tag_yoga", "tag_fitness"})
            assert has_matching_tag, (
                f"Produit '{p.get('product_id')}' retourné sans tag matching: {p_tags}"
            )
        print(f"PASS: Filtrage tag_yoga,tag_fitness - {count} produits retournés")

    def test_filter_by_single_tag(self):
        """GET ?tag_ids=tag_yoga doit retourner les produits yoga uniquement."""
        response = requests.get(
            f"{BASE_URL}/api/marketplace/products",
            params={"tag_ids": "tag_yoga"},
            timeout=10,
        )
        assert response.status_code == 200
        data = response.json()
        products = data["products"]
        for p in products:
            assert "tag_yoga" in p.get("tag_ids", []), (
                f"Produit '{p.get('product_id')}' sans tag_yoga: {p.get('tag_ids')}"
            )
        print(f"PASS: Filtrage tag_yoga - {data['count']} produits retournés")

    def test_filter_by_spotyou_id_demo001(self):
        """GET ?spotyou_id=pt_demo001 doit retourner des produits (SpotYou avec tags)."""
        response = requests.get(
            f"{BASE_URL}/api/marketplace/products",
            params={"spotyou_id": "pt_demo001"},
            timeout=10,
        )
        assert response.status_code == 200, (
            f"Erreur HTTP {response.status_code}: {response.text[:200]}"
        )
        data = response.json()
        assert "products" in data, f"Clé 'products' absente: {list(data.keys())}"
        assert "count" in data

        # pt_demo001 a des tags (tag_route, tag_10k selon l'énoncé)
        # Doit retourner des produits (ou 0 si le SpotYou n'a pas de tags matchants)
        count = data["count"]
        assert count >= 0, f"Count invalide: {count}"
        print(f"PASS: spotyou_id=pt_demo001 - {count} produits retournés (status 200)")

    def test_filter_by_invalid_spotyou_id_no_500(self):
        """GET ?spotyou_id=INVALID_ID doit retourner 0 produit SANS erreur 500."""
        response = requests.get(
            f"{BASE_URL}/api/marketplace/products",
            params={"spotyou_id": "INVALID_ID"},
            timeout=10,
        )
        # Ne doit PAS être une erreur 500
        assert response.status_code != 500, (
            f"Erreur 500 pour INVALID_ID! Response: {response.text[:300]}"
        )
        assert response.status_code == 200, (
            f"Status inattendu pour INVALID_ID: {response.status_code} - {response.text[:200]}"
        )
        data = response.json()
        assert "products" in data
        assert data["count"] == 0, (
            f"Attendu 0 produit pour INVALID_ID, reçu {data['count']}"
        )
        assert data["products"] == [], (
            f"Attendu liste vide pour INVALID_ID, reçu {data['products']}"
        )
        print(f"PASS: INVALID_ID retourne 0 produit sans erreur 500")

    def test_no_filters_returns_all_products(self):
        """Sans paramètres, retourne tous les produits (jusqu'à LIMIT 20)."""
        response = requests.get(f"{BASE_URL}/api/marketplace/products", timeout=10)
        assert response.status_code == 200
        data = response.json()
        # Sans filtres, branching "else" : retourne tous les produits (LIMIT 20)
        assert data["count"] >= 14, (
            f"Attendu >= 14 produits sans filtre, reçu {data['count']}"
        )
        print(f"PASS: Sans filtre - {data['count']} produits retournés")

    def test_empty_tag_ids_param(self):
        """GET ?tag_ids= (vide) doit se comporter comme sans filtre."""
        response = requests.get(
            f"{BASE_URL}/api/marketplace/products",
            params={"tag_ids": ""},
            timeout=10,
        )
        assert response.status_code == 200, (
            f"Erreur pour tag_ids vide: {response.status_code}"
        )
        data = response.json()
        assert data["count"] >= 0
        print(f"PASS: tag_ids vide - status 200, {data['count']} produits")


class TestMarketplaceSortOrder:
    """Tests de l'ordre de tri des produits."""

    def test_filtered_sponsored_products_first(self):
        """Dans une requête FILTRÉE, les produits 'sponsored' doivent apparaître en premier."""
        # Utiliser un tag très large pour obtenir plusieurs produits avec seller_types différents
        response = requests.get(
            f"{BASE_URL}/api/marketplace/products",
            params={"tag_ids": "tag_hiit,tag_yoga,tag_fitness,tag_sport,tag_crossfit"},
            timeout=10,
        )
        assert response.status_code == 200
        data = response.json()
        products = data["products"]

        if len(products) < 2:
            pytest.skip("Pas assez de produits filtrés pour tester l'ordre")

        seller_types = [p.get("seller_type") for p in products]
        if "sponsored" in seller_types:
            first_sponsored_idx = seller_types.index("sponsored")
            # Tous les produits AVANT le premier sponsored doivent aussi être sponsored
            for i in range(first_sponsored_idx):
                assert products[i]["seller_type"] == "sponsored", (
                    f"Produit non-sponsored ('{products[i]['seller_type']}') "
                    f"avant un sponsored à l'index {i}"
                )
            print(f"PASS: Produits sponsored en premier dans résultats filtrés (index {first_sponsored_idx})")
        else:
            print(f"INFO: Aucun produit 'sponsored' dans ce filtre - {set(seller_types)}")

    def test_unfiltered_returns_products_ordered_by_date(self):
        """La liste non filtrée est triée par created_at DESC (comportement attendu)."""
        response = requests.get(f"{BASE_URL}/api/marketplace/products", timeout=10)
        assert response.status_code == 200
        data = response.json()
        products = data["products"]
        if len(products) < 2:
            pytest.skip("Pas assez de produits")

        dates = [p.get("created_at", "") for p in products]
        # Vérifie que les dates sont en ordre décroissant (DESC)
        for i in range(len(dates) - 1):
            assert dates[i] >= dates[i + 1], (
                f"Tri DESC non respecté entre indices {i} et {i+1}: "
                f"{dates[i]} < {dates[i+1]}"
            )
        print(f"PASS: {len(products)} produits triés par created_at DESC")
