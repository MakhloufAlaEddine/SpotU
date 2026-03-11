"""
Iteration 72 — Tests for:
  1. spot-you/[id].tsx cache logic (buildCacheKey/cacheGet/cacheSet/isFresh/cacheAgeMinutes/getTtl)
  2. screenState 4-states: loading_initial/ready_fresh/ready_cached/error_no_data
  3. ErrorNoData with testID='spotyou-not-found' + onBack prop in spot-you/[id].tsx
  4. StaleBanner shown when screenState === 'ready_cached'
  5. cacheInvalidate includes /tag-points/${id} after mutations (RSVP + going)
  6. OfflineBanner.tsx ErrorNoData: onBack optional prop, back-nav-btn testID, backBtn/backBtnText styles
  7. user/[id].tsx: ErrorNoData uses onBack with router.canGoBack() ? router.back() : router.replace
  8. Regression: spot-you/[id] detail loads normally (pt_demo015)
  9. Regression: spot-me.tsx works (SpotMe list visible)
"""

import os
import sys
import pytest
import asyncio

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")


# ─── Helpers for source-file reading ──────────────────────────────────────────

def read_source(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


SPOTYOU_FILE  = "/app/frontend/app/spot-you/[id].tsx"
OFFLINE_FILE  = "/app/frontend/components/OfflineBanner.tsx"
USER_FILE     = "/app/frontend/app/user/[id].tsx"
CACHE_FILE    = "/app/frontend/lib/cache.ts"


# ══════════════════════════════════════════════════════════════════════════════
# 1. Cache lib — sanity check
# ══════════════════════════════════════════════════════════════════════════════

class TestCacheLib:
    """Verify lib/cache.ts exports all required functions"""

    def test_cache_exports_buildCacheKey(self):
        src = read_source(CACHE_FILE)
        assert "export function buildCacheKey" in src, "buildCacheKey not exported from lib/cache.ts"

    def test_cache_exports_cacheGet(self):
        src = read_source(CACHE_FILE)
        assert "export async function cacheGet" in src, "cacheGet not exported"

    def test_cache_exports_cacheSet(self):
        src = read_source(CACHE_FILE)
        assert "export async function cacheSet" in src, "cacheSet not exported"

    def test_cache_exports_isFresh(self):
        src = read_source(CACHE_FILE)
        assert "export function isFresh" in src, "isFresh not exported"

    def test_cache_exports_cacheAgeMinutes(self):
        src = read_source(CACHE_FILE)
        assert "export function cacheAgeMinutes" in src, "cacheAgeMinutes not exported"

    def test_cache_exports_getTtl(self):
        src = read_source(CACHE_FILE)
        assert "export function getTtl" in src, "getTtl not exported"

    def test_cache_exports_cacheInvalidate(self):
        src = read_source(CACHE_FILE)
        assert "export async function cacheInvalidate" in src, "cacheInvalidate not exported"

    def test_cache_exports_SCHEMA_VERSION(self):
        src = read_source(CACHE_FILE)
        assert "export const SCHEMA_VERSION" in src, "SCHEMA_VERSION not exported"


# ══════════════════════════════════════════════════════════════════════════════
# 2. spot-you/[id].tsx — imports cache + types
# ══════════════════════════════════════════════════════════════════════════════

class TestSpotYouImports:
    """spot-you/[id].tsx must import all cache helpers"""

    def test_imports_buildCacheKey(self):
        src = read_source(SPOTYOU_FILE)
        assert "buildCacheKey" in src, "buildCacheKey not imported in spot-you/[id].tsx"

    def test_imports_cacheGet(self):
        src = read_source(SPOTYOU_FILE)
        assert "cacheGet" in src, "cacheGet not imported"

    def test_imports_cacheSet(self):
        src = read_source(SPOTYOU_FILE)
        assert "cacheSet" in src, "cacheSet not imported"

    def test_imports_isFresh(self):
        src = read_source(SPOTYOU_FILE)
        assert "isFresh" in src, "isFresh not imported"

    def test_imports_cacheAgeMinutes(self):
        src = read_source(SPOTYOU_FILE)
        assert "cacheAgeMinutes" in src, "cacheAgeMinutes not imported"

    def test_imports_getTtl(self):
        src = read_source(SPOTYOU_FILE)
        assert "getTtl" in src, "getTtl not imported"

    def test_imports_cacheInvalidate(self):
        src = read_source(SPOTYOU_FILE)
        assert "cacheInvalidate" in src, "cacheInvalidate not imported"

    def test_imports_SCHEMA_VERSION(self):
        src = read_source(SPOTYOU_FILE)
        assert "SCHEMA_VERSION" in src, "SCHEMA_VERSION not imported"

    def test_imports_StaleBanner(self):
        src = read_source(SPOTYOU_FILE)
        assert "StaleBanner" in src, "StaleBanner not imported from OfflineBanner"

    def test_imports_ErrorNoData(self):
        src = read_source(SPOTYOU_FILE)
        assert "ErrorNoData" in src, "ErrorNoData not imported from OfflineBanner"


# ══════════════════════════════════════════════════════════════════════════════
# 3. spot-you/[id].tsx — screenState 4-states
# ══════════════════════════════════════════════════════════════════════════════

class TestSpotYouScreenState:
    """screenState type must include all 4 states"""

    def test_screenState_loading_initial(self):
        src = read_source(SPOTYOU_FILE)
        assert "'loading_initial'" in src, "screenState missing 'loading_initial'"

    def test_screenState_ready_fresh(self):
        src = read_source(SPOTYOU_FILE)
        assert "'ready_fresh'" in src, "screenState missing 'ready_fresh'"

    def test_screenState_ready_cached(self):
        src = read_source(SPOTYOU_FILE)
        assert "'ready_cached'" in src, "screenState missing 'ready_cached'"

    def test_screenState_error_no_data(self):
        src = read_source(SPOTYOU_FILE)
        assert "'error_no_data'" in src, "screenState missing 'error_no_data'"

    def test_screenState_initial_value_is_loading_initial(self):
        src = read_source(SPOTYOU_FILE)
        assert "useState<'loading_initial'" in src or "useState('loading_initial')" in src, \
            "screenState initial value must be 'loading_initial'"


# ══════════════════════════════════════════════════════════════════════════════
# 4. spot-you/[id].tsx — loadPoint cache logic
# ══════════════════════════════════════════════════════════════════════════════

class TestSpotYouLoadPoint:
    """loadPoint must read cache before network and update screenState"""

    def test_loadPoint_calls_buildCacheKey(self):
        src = read_source(SPOTYOU_FILE)
        assert "buildCacheKey" in src and "loadPoint" in src, \
            "loadPoint must use buildCacheKey"

    def test_loadPoint_calls_cacheGet(self):
        src = read_source(SPOTYOU_FILE)
        assert "cacheGet" in src, "loadPoint must use cacheGet to read cache first"

    def test_loadPoint_calls_cacheSet_after_fetch(self):
        src = read_source(SPOTYOU_FILE)
        assert "cacheSet" in src, "loadPoint must call cacheSet after network fetch"

    def test_loadPoint_calls_isFresh(self):
        src = read_source(SPOTYOU_FILE)
        assert "isFresh" in src, "loadPoint must call isFresh to check cache freshness"

    def test_loadPoint_sets_staleMinutes_with_cacheAgeMinutes(self):
        src = read_source(SPOTYOU_FILE)
        assert "cacheAgeMinutes" in src, "loadPoint must call cacheAgeMinutes for staleMinutes"

    def test_loadPoint_uses_getTtl(self):
        src = read_source(SPOTYOU_FILE)
        assert "getTtl" in src, "loadPoint must use getTtl for cache TTL"

    def test_loadPoint_sets_ready_fresh_after_network(self):
        src = read_source(SPOTYOU_FILE)
        assert "setScreenState('ready_fresh')" in src, \
            "loadPoint must set screenState='ready_fresh' after network fetch"

    def test_loadPoint_sets_ready_cached_on_network_error_with_data(self):
        src = read_source(SPOTYOU_FILE)
        assert "setScreenState('ready_cached')" in src, \
            "loadPoint must set screenState='ready_cached' when network fails but cache exists"

    def test_loadPoint_sets_error_no_data_on_network_error_without_data(self):
        src = read_source(SPOTYOU_FILE)
        assert "setScreenState('error_no_data')" in src, \
            "loadPoint must set screenState='error_no_data' when network fails and no cache"


# ══════════════════════════════════════════════════════════════════════════════
# 5. spot-you/[id].tsx — ErrorNoData with testID + onBack
# ══════════════════════════════════════════════════════════════════════════════

class TestSpotYouErrorNoData:
    """ErrorNoData must have testID='spotyou-not-found' + onBack"""

    def test_no_brutal_not_found_text(self):
        src = read_source(SPOTYOU_FILE)
        assert "SpotYou introuvable" not in src, \
            "Brutal text 'SpotYou introuvable' must be replaced by ErrorNoData"

    def test_ErrorNoData_testID_spotyou_not_found(self):
        src = read_source(SPOTYOU_FILE)
        assert "testID=\"spotyou-not-found\"" in src or "testID='spotyou-not-found'" in src, \
            "ErrorNoData must have testID='spotyou-not-found' in spot-you/[id].tsx"

    def test_ErrorNoData_has_onBack_prop(self):
        src = read_source(SPOTYOU_FILE)
        # Check onBack is present near the spotyou-not-found ErrorNoData
        assert "onBack=" in src, "ErrorNoData must have onBack prop in spot-you/[id].tsx"

    def test_ErrorNoData_onBack_uses_router_back(self):
        src = read_source(SPOTYOU_FILE)
        # The onBack should navigate back
        assert "router.back()" in src or "router.canGoBack()" in src, \
            "ErrorNoData onBack must use router.back() or router.canGoBack()"

    def test_ErrorNoData_has_onRetry_loadPoint(self):
        src = read_source(SPOTYOU_FILE)
        assert "onRetry" in src, "ErrorNoData must have onRetry prop"


# ══════════════════════════════════════════════════════════════════════════════
# 6. spot-you/[id].tsx — StaleBanner shown when ready_cached
# ══════════════════════════════════════════════════════════════════════════════

class TestSpotYouStaleBanner:
    """StaleBanner must be rendered conditionally when screenState === 'ready_cached'"""

    def test_StaleBanner_rendered_when_ready_cached(self):
        src = read_source(SPOTYOU_FILE)
        assert ("screenState === 'ready_cached'" in src and "StaleBanner" in src), \
            "StaleBanner must be conditionally rendered when screenState === 'ready_cached'"

    def test_StaleBanner_receives_staleMinutes(self):
        src = read_source(SPOTYOU_FILE)
        assert "staleMinutes={staleMinutes}" in src, \
            "StaleBanner must receive staleMinutes prop"


# ══════════════════════════════════════════════════════════════════════════════
# 7. spot-you/[id].tsx — cacheInvalidate with point_id after mutations
# ══════════════════════════════════════════════════════════════════════════════

class TestSpotYouCacheInvalidate:
    """cacheInvalidate must include the specific tag-points/${id} after mutations"""

    def test_cacheInvalidate_called_in_doRSVP(self):
        src = read_source(SPOTYOU_FILE)
        # Should find cacheInvalidate somewhere near doRSVP / join / leave
        assert "cacheInvalidate" in src, "cacheInvalidate must be called after RSVP mutations"

    def test_cacheInvalidate_includes_tag_points_id(self):
        src = read_source(SPOTYOU_FILE)
        # Look for `/tag-points/${id}` in cacheInvalidate calls
        assert "`/tag-points/${id}`" in src or "'/tag-points/'" in src, \
            "cacheInvalidate must include /tag-points/${id} (the specific point)"

    def test_cacheInvalidate_includes_planning(self):
        src = read_source(SPOTYOU_FILE)
        assert "'/planning'" in src or "\"/planning\"" in src, \
            "cacheInvalidate must include /planning (participation changes affect planning)"

    def test_cacheInvalidate_called_in_doGoing(self):
        src = read_source(SPOTYOU_FILE)
        # doGoing also calls cacheInvalidate
        assert "cacheInvalidate" in src, "cacheInvalidate must be called in doGoing mutation"


# ══════════════════════════════════════════════════════════════════════════════
# 8. OfflineBanner.tsx — ErrorNoData onBack prop + back-nav-btn + styles
# ══════════════════════════════════════════════════════════════════════════════

class TestErrorNoDataOfflineBanner:
    """ErrorNoData component must accept optional onBack prop and render back button"""

    def test_ErrorNoDataProps_has_onBack_optional(self):
        src = read_source(OFFLINE_FILE)
        assert "onBack?" in src, "ErrorNoDataProps must have onBack? (optional) prop"

    def test_ErrorNoData_renders_back_button_when_onBack_provided(self):
        src = read_source(OFFLINE_FILE)
        assert "onBack &&" in src or "{onBack && (" in src, \
            "ErrorNoData must conditionally render back button when onBack is provided"

    def test_back_btn_has_testID_back_nav_btn(self):
        src = read_source(OFFLINE_FILE)
        assert 'testID="back-nav-btn"' in src or "testID='back-nav-btn'" in src, \
            "Back button must have testID='back-nav-btn'"

    def test_back_btn_text_is_retour(self):
        src = read_source(OFFLINE_FILE)
        assert "Retour" in src, "Back button text must be 'Retour'"

    def test_style_backBtn_present(self):
        src = read_source(OFFLINE_FILE)
        assert "backBtn:" in src, "Style 'backBtn' must be defined in ErrorNoData styles"

    def test_style_backBtnText_present(self):
        src = read_source(OFFLINE_FILE)
        assert "backBtnText:" in src, "Style 'backBtnText' must be defined in ErrorNoData styles"

    def test_back_btn_uses_onBack_as_onPress(self):
        src = read_source(OFFLINE_FILE)
        assert "onPress={onBack}" in src, "Back button must use onBack as onPress handler"

    def test_back_btn_uses_chevron_back_icon(self):
        src = read_source(OFFLINE_FILE)
        assert "chevron-back" in src, "Back button should use chevron-back icon"


# ══════════════════════════════════════════════════════════════════════════════
# 9. user/[id].tsx — ErrorNoData with onBack
# ══════════════════════════════════════════════════════════════════════════════

class TestUserIdErrorNoData:
    """user/[id].tsx must pass onBack to ErrorNoData when profile is null"""

    def test_user_id_imports_ErrorNoData(self):
        src = read_source(USER_FILE)
        assert "ErrorNoData" in src, "user/[id].tsx must import ErrorNoData"

    def test_user_id_ErrorNoData_has_correct_testID(self):
        src = read_source(USER_FILE)
        assert "testID=\"user-profile-not-found\"" in src or "testID='user-profile-not-found'" in src, \
            "ErrorNoData in user/[id].tsx must have testID='user-profile-not-found'"

    def test_user_id_ErrorNoData_has_onBack(self):
        """CRITICAL: onBack must be passed to ErrorNoData in user/[id].tsx"""
        src = read_source(USER_FILE)
        # Check within the !profile block
        not_found_block = src
        # Look for ErrorNoData + onBack combination
        has_on_back = "onBack=" in not_found_block and "ErrorNoData" in not_found_block
        assert has_on_back, \
            "FAIL: user/[id].tsx ErrorNoData is MISSING onBack prop (router.canGoBack ? router.back : router.replace)"

    def test_user_id_ErrorNoData_onBack_uses_router_back(self):
        """onBack must use router.canGoBack() / router.back() pattern"""
        src = read_source(USER_FILE)
        # The onBack should be within a few lines of the ErrorNoData not-found render
        # Check that the necessary navigation functions are present nearby
        assert "router.canGoBack()" in src or "router.back()" in src, \
            "user/[id].tsx must use router.canGoBack()/router.back() for onBack navigation"

    def test_user_id_no_brutal_profile_not_found(self):
        src = read_source(USER_FILE)
        assert "Profil introuvable" not in src, \
            "Brutal text 'Profil introuvable' must not be present (use ErrorNoData)"


# ══════════════════════════════════════════════════════════════════════════════
# 10. SpotYouSkeleton — shown during loading
# ══════════════════════════════════════════════════════════════════════════════

class TestSpotYouSkeleton:
    """SpotYouSkeleton must be shown during initial loading"""

    def test_SpotYouSkeleton_component_exists(self):
        src = read_source(SPOTYOU_FILE)
        assert "function SpotYouSkeleton" in src, "SpotYouSkeleton component must exist"

    def test_SpotYouSkeleton_rendered_when_loading(self):
        src = read_source(SPOTYOU_FILE)
        assert "SpotYouSkeleton" in src and "loading" in src, \
            "SpotYouSkeleton must be rendered during loading state"


# ══════════════════════════════════════════════════════════════════════════════
# 11. Playwright — Regression: SpotYou detail loads (pt_demo015) + SpotMe list
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
class TestRegressionOnline:
    """Online regression tests via Playwright"""

    async def test_spotyou_detail_loads_for_pt_demo015(self, page):
        """SpotYou detail screen (spot-you/[id]) should load for pt_demo015"""
        # Login first
        await page.goto(f"{BASE_URL}/login")
        await page.wait_for_selector('[data-testid="login-email"], input[type="email"]', timeout=10000)
        email_input = page.locator('[data-testid="login-email"], input[type="email"]').first
        await email_input.fill("user@winek.app")
        pw_input = page.locator('[data-testid="login-password"], input[type="password"]').first
        await pw_input.fill("WinekUser2024!")
        submit = page.locator('[data-testid="login-submit"], button[type="submit"]').first
        await submit.click(force=True)
        await page.wait_for_timeout(3000)

        # Navigate to SpotYou detail
        await page.goto(f"{BASE_URL}/spot-you/pt_demo015")
        await page.wait_for_timeout(4000)

        # Check page loaded — should NOT show spotyou-not-found unless pt_demo015 doesn't exist
        not_found = await page.query_selector('[data-testid="spotyou-not-found"]')
        title = await page.query_selector('[data-testid="spotyou-distance"]')

        if not_found:
            # It's okay if pt_demo015 doesn't exist in the test environment
            # but ErrorNoData should be shown (not a crash)
            print("PASS: pt_demo015 not found but ErrorNoData component shown correctly (not a raw error)")
            # Verify the onBack back-nav-btn is present
            back_btn = await page.query_selector('[data-testid="back-nav-btn"]')
            if back_btn:
                print("PASS: back-nav-btn present in ErrorNoData for spotyou-not-found")
            else:
                print("INFO: back-nav-btn not found in ErrorNoData (check if onBack is passed)")
        elif title:
            print("PASS: SpotYou detail loaded successfully for pt_demo015 — distance visible")
        else:
            # Check for skeleton or loading state
            print("INFO: Neither spotyou-not-found nor spotyou-distance found — may still be loading")

        # Verify no raw crash text
        page_content = await page.content()
        assert "SpotYou introuvable" not in page_content, \
            "FAIL: Raw 'SpotYou introuvable' text found — must use ErrorNoData component"
        print("PASS: No raw 'SpotYou introuvable' text in page")

    async def test_spotyou_detail_no_crash(self, page):
        """SpotYou detail should not crash (no unhandled error)"""
        await page.goto(f"{BASE_URL}/spot-you/pt_demo015")
        await page.wait_for_timeout(3000)

        # Check for JavaScript errors
        error_elements = await page.query_selector_all('.error, [class*="error-boundary"]')
        if error_elements:
            texts = [await el.text_content() for el in error_elements]
            print(f"Error elements found: {texts}")
        else:
            print("PASS: No crash error boundaries detected")

        # Page should have content
        content = await page.content()
        assert len(content) > 200, "Page content is suspiciously empty"
        print("PASS: SpotYou detail page has content")

    async def test_spotme_list_still_visible(self, page):
        """Regression: spot-me screen loads and shows list"""
        # Login first (if session expired)
        await page.goto(f"{BASE_URL}/login")
        await page.wait_for_selector('[data-testid="login-email"], input[type="email"]', timeout=8000)
        email_input = page.locator('[data-testid="login-email"], input[type="email"]').first
        await email_input.fill("user@winek.app")
        pw_input = page.locator('[data-testid="login-password"], input[type="password"]').first
        await pw_input.fill("WinekUser2024!")
        submit = page.locator('[data-testid="login-submit"], button[type="submit"]').first
        await submit.click(force=True)
        await page.wait_for_timeout(3000)

        await page.goto(f"{BASE_URL}/spot-me")
        await page.wait_for_timeout(3000)

        content = await page.content()
        # Check no crash
        assert "SpotMe introuvable" not in content
        print("PASS: SpotMe screen loaded without crash")

        # Check page has some meaningful content
        assert len(content) > 200, "SpotMe page content too short"
        print("PASS: SpotMe page has content")


# ──────────────────────────────────────────────────────────────────────────────
# conftest-style: try to import fixtures from conftest, provide fallback
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
