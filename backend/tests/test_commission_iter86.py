"""
Iteration 86: Test commission endpoint and pricing rules
Tests GET /api/config/commission public endpoint
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://metro-stability.preview.emergentagent.com').rstrip('/')

class TestCommissionEndpoint:
    """Tests for GET /api/config/commission public endpoint"""
    
    @pytest.fixture
    def admin_token(self):
        """Login as admin to manage pricing rules"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@winek.app",
            "password": "WinekAdmin2024!"
        })
        if response.status_code == 200:
            return response.json().get("token")
        pytest.skip("Admin login failed")
    
    def test_commission_endpoint_returns_200(self):
        """Commission endpoint should be publicly accessible (no auth required)"""
        response = requests.get(f"{BASE_URL}/api/config/commission")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print(f"✓ Commission endpoint accessible without auth")
    
    def test_commission_response_structure(self):
        """Verify response has all required fields"""
        response = requests.get(f"{BASE_URL}/api/config/commission")
        assert response.status_code == 200
        data = response.json()
        
        required_fields = [
            "payer_percent_fee",
            "payer_fixed_fee",
            "receiver_percent_fee",
            "receiver_fixed_fee",
            "total_percent_fee",
            "has_rule"
        ]
        
        for field in required_fields:
            assert field in data, f"Missing field: {field}"
        print(f"✓ Response contains all required fields: {list(data.keys())}")
    
    def test_commission_values_with_active_rule(self):
        """With existing pricing rule, commission should show correct values"""
        response = requests.get(f"{BASE_URL}/api/config/commission")
        assert response.status_code == 200
        data = response.json()
        
        # Based on seed data: rule_5a33a954cf54 (5% payer + 10% receiver)
        assert data["has_rule"] == True, "Expected has_rule=True with existing rule"
        assert data["payer_percent_fee"] == 5, f"Expected payer_percent_fee=5, got {data['payer_percent_fee']}"
        assert data["receiver_percent_fee"] == 10, f"Expected receiver_percent_fee=10, got {data['receiver_percent_fee']}"
        assert data["total_percent_fee"] == 15, f"Expected total_percent_fee=15, got {data['total_percent_fee']}"
        print(f"✓ Commission values correct: {data['payer_percent_fee']}% payer + {data['receiver_percent_fee']}% receiver = {data['total_percent_fee']}% total")
    
    def test_commission_net_calculation(self):
        """Verify net amount calculation works correctly"""
        response = requests.get(f"{BASE_URL}/api/config/commission")
        data = response.json()
        
        # Test calculation: for a 60€ service with 15% total commission
        test_price = 60
        commission_pct = data["total_percent_fee"]
        expected_net = test_price * (1 - commission_pct / 100)
        
        assert expected_net == 51.0, f"Expected net=51.0 for 60€ with 15%, got {expected_net}"
        print(f"✓ Net calculation: {test_price}€ - {commission_pct}% = {expected_net}€")


class TestPricingRulesAdmin:
    """Admin tests for pricing rules management"""
    
    @pytest.fixture
    def admin_session(self):
        """Get authenticated admin session"""
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@winek.app",
            "password": "WinekAdmin2024!"
        })
        if response.status_code == 200:
            token = response.json().get("token")
            session.headers.update({"Authorization": f"Bearer {token}"})
            return session
        pytest.skip("Admin login failed")
    
    def test_list_pricing_rules(self, admin_session):
        """Admin should be able to list all pricing rules"""
        response = admin_session.get(f"{BASE_URL}/api/admin/pricing-rules")
        assert response.status_code == 200
        rules = response.json()
        assert isinstance(rules, list)
        print(f"✓ Found {len(rules)} pricing rule(s)")
        
        # Verify service_booking rule exists
        service_rules = [r for r in rules if r.get("product_type") == "service_booking"]
        assert len(service_rules) > 0, "Expected at least one service_booking rule"
        print(f"✓ Found service_booking rule: {service_rules[0].get('rule_id')}")
    
    def test_pricing_rule_deactivation_and_commission(self, admin_session):
        """
        When pricing rule is deactivated, commission should return has_rule=false
        Note: This test deactivates then reactivates the rule to not affect other tests
        """
        # Get current rules
        rules_resp = admin_session.get(f"{BASE_URL}/api/admin/pricing-rules")
        assert rules_resp.status_code == 200
        rules = rules_resp.json()
        
        service_rules = [r for r in rules if r.get("product_type") == "service_booking" and r.get("active")]
        if not service_rules:
            pytest.skip("No active service_booking rule to test")
        
        rule = service_rules[0]
        rule_id = rule["rule_id"]
        
        # Deactivate rule
        deact_resp = admin_session.put(f"{BASE_URL}/api/admin/pricing-rules/{rule_id}", json={"active": False})
        assert deact_resp.status_code == 200, f"Failed to deactivate: {deact_resp.text}"
        print(f"✓ Deactivated rule {rule_id}")
        
        # Check commission now returns has_rule=false
        comm_resp = requests.get(f"{BASE_URL}/api/config/commission")
        assert comm_resp.status_code == 200
        comm_data = comm_resp.json()
        assert comm_data["has_rule"] == False, f"Expected has_rule=False after deactivation, got {comm_data}"
        assert comm_data["total_percent_fee"] == 0, f"Expected total_percent_fee=0, got {comm_data['total_percent_fee']}"
        print(f"✓ Commission returns has_rule=False when no active rule")
        
        # Reactivate rule
        react_resp = admin_session.put(f"{BASE_URL}/api/admin/pricing-rules/{rule_id}", json={"active": True})
        assert react_resp.status_code == 200, f"Failed to reactivate: {react_resp.text}"
        print(f"✓ Reactivated rule {rule_id}")
        
        # Verify commission is back
        final_comm = requests.get(f"{BASE_URL}/api/config/commission")
        assert final_comm.status_code == 200
        final_data = final_comm.json()
        assert final_data["has_rule"] == True, "Rule should be active again"
        print(f"✓ Commission restored: {final_data}")


class TestServiceEndpoints:
    """Test service endpoints still work correctly"""
    
    @pytest.fixture
    def coach_session(self):
        """Get authenticated coach session"""
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "coach@winek.app",
            "password": "WinekCoach2024!"
        })
        if response.status_code == 200:
            token = response.json().get("token")
            session.headers.update({"Authorization": f"Bearer {token}"})
            return session
        pytest.skip("Coach login failed")
    
    def test_get_demo_service(self):
        """Demo service svc_demo001 should be accessible"""
        response = requests.get(f"{BASE_URL}/api/services/svc_demo001")
        assert response.status_code == 200
        data = response.json()
        assert data["service_id"] == "svc_demo001"
        print(f"✓ Demo service loaded: {data['title']} - {data['price']}€")
    
    def test_service_create_still_works(self, coach_session):
        """Service creation should still work (regression test)"""
        payload = {
            "title": "TEST_Commission Test Service",
            "description": "Testing commission display",
            "price": 100,
            "duration_min": 60,
            "max_participants": 1,
            "domain_id": "dom_sport",
            "tag_ids": ["tag_musculation"],
            "packages": [{
                "type_id": "main",
                "type_label": "Service principal",
                "duration_min": 60,
                "max_participants": 1,
                "price": 100,
                "slots": []
            }],
            "locations": [],
            "slots": []
        }
        
        response = coach_session.post(f"{BASE_URL}/api/services", json=payload)
        assert response.status_code in [200, 201], f"Service creation failed: {response.text}"
        data = response.json()
        service_id = data.get("service_id") or data.get("id")
        print(f"✓ Service created: {service_id}")
        
        # Cleanup
        if service_id:
            coach_session.delete(f"{BASE_URL}/api/services/{service_id}")
            print(f"✓ Cleaned up test service")
    
    def test_service_update_still_works(self, coach_session):
        """Service update should still work (regression test)"""
        # Update demo service price
        response = coach_session.put(f"{BASE_URL}/api/services/svc_demo001", json={
            "title": "Coaching football personnalisé"  # Original title
        })
        assert response.status_code == 200, f"Service update failed: {response.text}"
        print(f"✓ Service update works")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
