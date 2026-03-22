"""
Test Suite for SpotYou (TagPoint) Address Privacy Masking - Iteration 87

Tests address masking in tag_points based on precision level:
- exact: full address unchanged
- 100m: street without house number
- 1000m: city/neighborhood only

Features tested:
1. GET /api/tag-points/{id} anonymous -> address=masked, is_owner=false, no original_address
2. GET /api/tag-points/{id} as owner -> address=masked, is_owner=true, original_address=full
3. GET /api/tag-points/{id} owner with exact precision -> address=full, is_owner=true, no original_address
4. POST /api/tag-points creates with address field
5. PUT /api/tag-points/{id} updates address and returns is_owner=true
6. Address masking for 1000m returns city (not "France")
7. Address masking for 100m returns street without house number
8. Regression: GET /api/services/{id} address masking still works
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://coach-products.preview.emergentagent.com')

# Test credentials
USER_OWNER_EMAIL = "user@winek.app"
USER_OWNER_PASSWORD = "WinekUser2024!"
USER_OWNER_ID = "user_demo001"

COACH_EMAIL = "coach@winek.app"
COACH_PASSWORD = "WinekCoach2024!"
COACH_ID = "user_coach001"

# Test addresses - French format
TEST_ADDRESS_FULL = "12 Rue de Rivoli, 75001 Paris, France"
TEST_ADDRESS_100M_EXPECTED = "Rue de Rivoli"
TEST_ADDRESS_1000M_EXPECTED = "Paris"

# Demo point IDs
POINT_ID_OWNER = "pt_demo001"    # owned by user_demo001 (user@winek.app)
POINT_ID_COACH = "pt_demo003"    # owned by user_coach001 (coach@winek.app)


@pytest.fixture(scope="module")
def user_token():
    """Get JWT token for user_demo001 (user@winek.app)"""
    response = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": USER_OWNER_EMAIL, "password": USER_OWNER_PASSWORD}
    )
    if response.status_code != 200:
        pytest.skip(f"User login failed: {response.status_code} - {response.text}")
    return response.json().get("token")


@pytest.fixture(scope="module")
def coach_token():
    """Get JWT token for user_coach001 (coach@winek.app)"""
    response = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": COACH_EMAIL, "password": COACH_PASSWORD}
    )
    if response.status_code != 200:
        pytest.skip(f"Coach login failed: {response.status_code} - {response.text}")
    return response.json().get("token")


@pytest.fixture(scope="module")
def setup_test_data():
    """Setup test data: update demo points with test addresses and precisions"""
    import psycopg2
    conn = psycopg2.connect(
        host="127.0.0.1",
        database="winek_db",
        user="winek",
        password="winek2024"
    )
    cur = conn.cursor()
    
    # Store original values
    cur.execute(
        "SELECT point_id, address, precision FROM tag_points WHERE point_id IN (%s, %s)",
        (POINT_ID_OWNER, POINT_ID_COACH)
    )
    original_values = {row[0]: {"address": row[1], "precision": row[2]} for row in cur.fetchall()}
    
    # Update pt_demo001 (user owner) with 1000m precision and test address
    cur.execute(
        "UPDATE tag_points SET address = %s, precision = %s WHERE point_id = %s",
        (TEST_ADDRESS_FULL, '1000m', POINT_ID_OWNER)
    )
    
    # Update pt_demo003 (coach owner) with 100m precision and test address
    cur.execute(
        "UPDATE tag_points SET address = %s, precision = %s WHERE point_id = %s",
        (TEST_ADDRESS_FULL, '100m', POINT_ID_COACH)
    )
    
    conn.commit()
    cur.close()
    conn.close()
    
    yield original_values
    
    # Teardown: restore original values
    conn = psycopg2.connect(
        host="127.0.0.1",
        database="winek_db",
        user="winek",
        password="winek2024"
    )
    cur = conn.cursor()
    for point_id, vals in original_values.items():
        cur.execute(
            "UPDATE tag_points SET address = %s, precision = %s WHERE point_id = %s",
            (vals["address"], vals["precision"], point_id)
        )
    conn.commit()
    cur.close()
    conn.close()


class TestTagPointAddressMasking:
    """Tests for GET /api/tag-points/{id} address masking"""

    def test_anonymous_1000m_gets_masked_address(self, setup_test_data):
        """Anonymous user viewing 1000m precision point gets city only, is_owner=false, no original_address"""
        response = requests.get(f"{BASE_URL}/api/tag-points/{POINT_ID_OWNER}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Should be masked to city only (not 'France')
        assert data.get("address") == TEST_ADDRESS_1000M_EXPECTED, \
            f"Expected address='{TEST_ADDRESS_1000M_EXPECTED}', got '{data.get('address')}'"
        
        # Anonymous should not be owner
        assert data.get("is_owner") == False, f"Expected is_owner=False, got {data.get('is_owner')}"
        
        # Anonymous should not get original_address
        assert "original_address" not in data or data.get("original_address") is None, \
            f"Anonymous should not get original_address, got: {data.get('original_address')}"
        
        print(f"PASS: Anonymous 1000m - address='{data.get('address')}', is_owner={data.get('is_owner')}")

    def test_anonymous_100m_gets_street_without_number(self, setup_test_data):
        """Anonymous user viewing 100m precision point gets street without number"""
        response = requests.get(f"{BASE_URL}/api/tag-points/{POINT_ID_COACH}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Should be masked to street without house number
        assert data.get("address") == TEST_ADDRESS_100M_EXPECTED, \
            f"Expected address='{TEST_ADDRESS_100M_EXPECTED}', got '{data.get('address')}'"
        
        # Anonymous should not be owner
        assert data.get("is_owner") == False, f"Expected is_owner=False, got {data.get('is_owner')}"
        
        print(f"PASS: Anonymous 100m - address='{data.get('address')}', is_owner={data.get('is_owner')}")

    def test_owner_1000m_gets_masked_address_with_original(self, setup_test_data, user_token):
        """Owner viewing 1000m precision point gets masked address, is_owner=true, original_address=full"""
        response = requests.get(
            f"{BASE_URL}/api/tag-points/{POINT_ID_OWNER}",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Should still be masked
        assert data.get("address") == TEST_ADDRESS_1000M_EXPECTED, \
            f"Expected address='{TEST_ADDRESS_1000M_EXPECTED}', got '{data.get('address')}'"
        
        # Owner should be true
        assert data.get("is_owner") == True, f"Expected is_owner=True, got {data.get('is_owner')}"
        
        # Owner should get original_address
        assert data.get("original_address") == TEST_ADDRESS_FULL, \
            f"Expected original_address='{TEST_ADDRESS_FULL}', got '{data.get('original_address')}'"
        
        print(f"PASS: Owner 1000m - address='{data.get('address')}', is_owner={data.get('is_owner')}, original_address='{data.get('original_address')}'")

    def test_owner_100m_gets_masked_address_with_original(self, setup_test_data, coach_token):
        """Owner viewing 100m precision point gets masked address, is_owner=true, original_address=full"""
        response = requests.get(
            f"{BASE_URL}/api/tag-points/{POINT_ID_COACH}",
            headers={"Authorization": f"Bearer {coach_token}"}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Should still be masked
        assert data.get("address") == TEST_ADDRESS_100M_EXPECTED, \
            f"Expected address='{TEST_ADDRESS_100M_EXPECTED}', got '{data.get('address')}'"
        
        # Owner should be true
        assert data.get("is_owner") == True, f"Expected is_owner=True, got {data.get('is_owner')}"
        
        # Owner should get original_address
        assert data.get("original_address") == TEST_ADDRESS_FULL, \
            f"Expected original_address='{TEST_ADDRESS_FULL}', got '{data.get('original_address')}'"
        
        print(f"PASS: Owner 100m - address='{data.get('address')}', is_owner={data.get('is_owner')}, original_address='{data.get('original_address')}'")

    def test_non_owner_sees_masked_address_no_original(self, setup_test_data, user_token):
        """Non-owner viewing someone else's point gets masked address, is_owner=false, no original_address"""
        # user_token belongs to user_demo001, POINT_ID_COACH is owned by coach
        response = requests.get(
            f"{BASE_URL}/api/tag-points/{POINT_ID_COACH}",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Should be masked
        assert data.get("address") == TEST_ADDRESS_100M_EXPECTED, \
            f"Expected address='{TEST_ADDRESS_100M_EXPECTED}', got '{data.get('address')}'"
        
        # Non-owner should not be owner
        assert data.get("is_owner") == False, f"Expected is_owner=False, got {data.get('is_owner')}"
        
        # Non-owner should not get original_address
        assert "original_address" not in data or data.get("original_address") is None, \
            f"Non-owner should not get original_address, got: {data.get('original_address')}"
        
        print(f"PASS: Non-owner - address='{data.get('address')}', is_owner={data.get('is_owner')}")


class TestTagPointExactPrecision:
    """Tests for exact precision behavior"""

    def test_owner_exact_precision_gets_full_address_no_original(self, user_token):
        """Owner with exact precision gets full address, is_owner=true, no original_address needed"""
        import psycopg2
        
        # Set up a point with exact precision and address
        conn = psycopg2.connect(
            host="127.0.0.1",
            database="winek_db",
            user="winek",
            password="winek2024"
        )
        cur = conn.cursor()
        
        # Get original values
        cur.execute(
            "SELECT address, precision FROM tag_points WHERE point_id = %s",
            (POINT_ID_OWNER,)
        )
        original = cur.fetchone()
        
        # Set exact precision with address
        cur.execute(
            "UPDATE tag_points SET address = %s, precision = 'exact' WHERE point_id = %s",
            (TEST_ADDRESS_FULL, POINT_ID_OWNER)
        )
        conn.commit()
        
        try:
            response = requests.get(
                f"{BASE_URL}/api/tag-points/{POINT_ID_OWNER}",
                headers={"Authorization": f"Bearer {user_token}"}
            )
            
            assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
            data = response.json()
            
            # Should be full address (not masked)
            assert data.get("address") == TEST_ADDRESS_FULL, \
                f"Expected address='{TEST_ADDRESS_FULL}', got '{data.get('address')}'"
            
            # Owner should be true
            assert data.get("is_owner") == True, f"Expected is_owner=True, got {data.get('is_owner')}"
            
            # With exact precision, no original_address needed
            assert "original_address" not in data or data.get("original_address") is None, \
                f"Exact precision should not need original_address, got: {data.get('original_address')}"
            
            print(f"PASS: Owner exact - address='{data.get('address')}', is_owner={data.get('is_owner')}")
            
        finally:
            # Restore original values
            cur.execute(
                "UPDATE tag_points SET address = %s, precision = %s WHERE point_id = %s",
                (original[0], original[1], POINT_ID_OWNER)
            )
            conn.commit()
            cur.close()
            conn.close()


class TestTagPointCreateWithAddress:
    """Tests for POST /api/tag-points with address field"""

    def test_create_tagpoint_with_address(self, user_token):
        """POST /api/tag-points creates SpotYou with address field stored correctly"""
        payload = {
            "title": "TEST_Address Privacy Test",
            "description": "Testing address storage",
            "latitude": 48.8566,
            "longitude": 2.3522,
            "precision": "100m",
            "tag_ids": ["tag_running"],
            "domain_id": "domain_sport",
            "address": TEST_ADDRESS_FULL
        }
        
        response = requests.post(
            f"{BASE_URL}/api/tag-points",
            json=payload,
            headers={"Authorization": f"Bearer {user_token}"}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        created_point_id = data.get("point_id")
        
        try:
            # Created point should have masked address
            assert data.get("address") == TEST_ADDRESS_100M_EXPECTED, \
                f"Expected address='{TEST_ADDRESS_100M_EXPECTED}', got '{data.get('address')}'"
            
            # Creator is owner
            assert data.get("is_owner") == True, f"Expected is_owner=True, got {data.get('is_owner')}"
            
            # Owner should get original_address
            assert data.get("original_address") == TEST_ADDRESS_FULL, \
                f"Expected original_address='{TEST_ADDRESS_FULL}', got '{data.get('original_address')}'"
            
            print(f"PASS: Create - point_id={created_point_id}, address='{data.get('address')}', original_address='{data.get('original_address')}'")
            
            # Verify persistence via direct DB query
            import psycopg2
            conn = psycopg2.connect(
                host="127.0.0.1",
                database="winek_db",
                user="winek",
                password="winek2024"
            )
            cur = conn.cursor()
            cur.execute(
                "SELECT address FROM tag_points WHERE point_id = %s",
                (created_point_id,)
            )
            db_address = cur.fetchone()[0]
            assert db_address == TEST_ADDRESS_FULL, \
                f"Database should store full address '{TEST_ADDRESS_FULL}', got '{db_address}'"
            cur.close()
            conn.close()
            
            print(f"PASS: DB persistence verified - stored address='{db_address}'")
            
        finally:
            # Cleanup: delete the test point
            requests.delete(
                f"{BASE_URL}/api/tag-points/{created_point_id}",
                headers={"Authorization": f"Bearer {user_token}"}
            )


class TestTagPointUpdateAddress:
    """Tests for PUT /api/tag-points/{id} address update"""

    def test_update_tagpoint_address(self, user_token):
        """PUT /api/tag-points/{id} updates address and returns is_owner=true"""
        # First create a test point
        create_payload = {
            "title": "TEST_Update Address Test",
            "description": "Testing address update",
            "latitude": 48.8566,
            "longitude": 2.3522,
            "precision": "1000m",
            "tag_ids": ["tag_running"],
            "domain_id": "domain_sport",
            "address": "Original Address, Paris, France"
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/tag-points",
            json=create_payload,
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert create_response.status_code == 200
        created_point_id = create_response.json().get("point_id")
        
        try:
            # Update the address
            update_payload = {
                "address": TEST_ADDRESS_FULL
            }
            
            update_response = requests.put(
                f"{BASE_URL}/api/tag-points/{created_point_id}",
                json=update_payload,
                headers={"Authorization": f"Bearer {user_token}"}
            )
            
            assert update_response.status_code == 200, \
                f"Expected 200, got {update_response.status_code}: {update_response.text}"
            data = update_response.json()
            
            # Updated point should have masked address
            assert data.get("address") == TEST_ADDRESS_1000M_EXPECTED, \
                f"Expected address='{TEST_ADDRESS_1000M_EXPECTED}', got '{data.get('address')}'"
            
            # Should be owner
            assert data.get("is_owner") == True, f"Expected is_owner=True, got {data.get('is_owner')}"
            
            # Owner should get original_address
            assert data.get("original_address") == TEST_ADDRESS_FULL, \
                f"Expected original_address='{TEST_ADDRESS_FULL}', got '{data.get('original_address')}'"
            
            print(f"PASS: Update - address='{data.get('address')}', is_owner={data.get('is_owner')}, original_address='{data.get('original_address')}'")
            
            # Verify via GET
            get_response = requests.get(
                f"{BASE_URL}/api/tag-points/{created_point_id}",
                headers={"Authorization": f"Bearer {user_token}"}
            )
            get_data = get_response.json()
            assert get_data.get("original_address") == TEST_ADDRESS_FULL, \
                f"GET after UPDATE should return original_address"
            
            print(f"PASS: GET after UPDATE verified")
            
        finally:
            # Cleanup
            requests.delete(
                f"{BASE_URL}/api/tag-points/{created_point_id}",
                headers={"Authorization": f"Bearer {user_token}"}
            )


class TestServiceAddressMaskingRegression:
    """Regression tests for service address masking (from iteration 86)"""

    def test_service_address_masking_still_works(self, coach_token):
        """Verify service address masking (regression from iter86)"""
        import psycopg2
        
        # Get a service owned by coach
        conn = psycopg2.connect(
            host="127.0.0.1",
            database="winek_db",
            user="winek",
            password="winek2024"
        )
        cur = conn.cursor()
        cur.execute(
            "SELECT service_id FROM services WHERE coach_id = %s AND active = TRUE LIMIT 1",
            (COACH_ID,)
        )
        row = cur.fetchone()
        if not row:
            pytest.skip("No services found for coach")
        service_id = row[0]
        
        # Get location_id for this service
        cur.execute(
            "SELECT location_id FROM service_locations WHERE service_id = %s LIMIT 1",
            (service_id,)
        )
        loc_row = cur.fetchone()
        if not loc_row:
            pytest.skip("No service locations found")
        location_id = loc_row[0]
        
        # Store original
        cur.execute(
            "SELECT description, precision FROM service_locations WHERE location_id = %s",
            (location_id,)
        )
        original = cur.fetchone()
        
        # Update to 1000m precision with test address
        cur.execute(
            "UPDATE service_locations SET description = %s, precision = '1000m' WHERE location_id = %s",
            (TEST_ADDRESS_FULL, location_id)
        )
        conn.commit()
        
        try:
            # Test as anonymous
            anon_response = requests.get(f"{BASE_URL}/api/services/{service_id}")
            assert anon_response.status_code == 200
            anon_data = anon_response.json()
            
            # Check locations
            locations = anon_data.get("locations", [])
            if locations:
                assert locations[0].get("description") == TEST_ADDRESS_1000M_EXPECTED, \
                    f"Expected masked location description='{TEST_ADDRESS_1000M_EXPECTED}', got '{locations[0].get('description')}'"
                assert "original_description" not in locations[0] or locations[0].get("original_description") is None, \
                    "Anonymous should not get original_description"
            
            print(f"PASS: Service regression - anonymous gets masked address")
            
            # Test as owner
            owner_response = requests.get(
                f"{BASE_URL}/api/services/{service_id}",
                headers={"Authorization": f"Bearer {coach_token}"}
            )
            assert owner_response.status_code == 200
            owner_data = owner_response.json()
            
            # Check is_owner
            assert owner_data.get("is_owner") == True, \
                f"Expected is_owner=True, got {owner_data.get('is_owner')}"
            
            # Check locations for owner
            owner_locations = owner_data.get("locations", [])
            if owner_locations:
                assert owner_locations[0].get("description") == TEST_ADDRESS_1000M_EXPECTED, \
                    f"Expected masked location description"
                assert owner_locations[0].get("original_description") == TEST_ADDRESS_FULL, \
                    f"Owner should get original_description='{TEST_ADDRESS_FULL}'"
            
            print(f"PASS: Service regression - owner gets is_owner=true and original_description")
            
        finally:
            # Restore original
            cur.execute(
                "UPDATE service_locations SET description = %s, precision = %s WHERE location_id = %s",
                (original[0], original[1], location_id)
            )
            conn.commit()
            cur.close()
            conn.close()


class TestAddressMaskingEdgeCases:
    """Edge case tests for address masking function"""

    def test_null_address_handling(self, user_token):
        """TagPoint with NULL address should not error"""
        import psycopg2
        conn = psycopg2.connect(
            host="127.0.0.1",
            database="winek_db",
            user="winek",
            password="winek2024"
        )
        cur = conn.cursor()
        
        # Get original address
        cur.execute(
            "SELECT address FROM tag_points WHERE point_id = %s",
            (POINT_ID_OWNER,)
        )
        original_address = cur.fetchone()[0]
        
        # Set NULL address
        cur.execute(
            "UPDATE tag_points SET address = NULL WHERE point_id = %s",
            (POINT_ID_OWNER,)
        )
        conn.commit()
        
        try:
            response = requests.get(
                f"{BASE_URL}/api/tag-points/{POINT_ID_OWNER}",
                headers={"Authorization": f"Bearer {user_token}"}
            )
            assert response.status_code == 200, \
                f"NULL address should not cause error, got {response.status_code}: {response.text}"
            
            data = response.json()
            assert data.get("address") is None or data.get("address") == "", \
                f"NULL address should remain NULL/empty"
            
            print(f"PASS: NULL address handled correctly")
            
        finally:
            cur.execute(
                "UPDATE tag_points SET address = %s WHERE point_id = %s",
                (original_address, POINT_ID_OWNER)
            )
            conn.commit()
            cur.close()
            conn.close()

    def test_1000m_skips_france_country_name(self, setup_test_data):
        """1000m precision should skip 'France' and return city"""
        # This is tested in the main tests with TEST_ADDRESS_FULL
        # which ends in ", France"
        response = requests.get(f"{BASE_URL}/api/tag-points/{POINT_ID_OWNER}")
        
        assert response.status_code == 200
        data = response.json()
        
        # Should NOT be 'France', should be 'Paris'
        assert data.get("address") != "France", \
            f"1000m masking should skip country name 'France', got '{data.get('address')}'"
        assert data.get("address") == TEST_ADDRESS_1000M_EXPECTED, \
            f"Expected '{TEST_ADDRESS_1000M_EXPECTED}', got '{data.get('address')}'"
        
        print(f"PASS: 1000m correctly skips 'France', returns '{data.get('address')}'")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
