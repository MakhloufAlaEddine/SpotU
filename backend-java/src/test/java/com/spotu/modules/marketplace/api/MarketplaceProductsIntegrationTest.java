package com.spotu.modules.marketplace.api;

import com.spotu.modules.auth.support.TestJwtTokens;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = {"/test-data-users.sql", "/test-data-marketplace.sql"}, executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class MarketplaceProductsIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void marketplaceFeed_public_withoutAuth_returnsActiveProductsOnly() throws Exception {
        mockMvc.perform(get("/api/marketplace/products").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.count", is(2)))
                .andExpect(jsonPath("$.products", hasSize(2)))
                .andExpect(jsonPath("$.products[0].item_type", is("product")))
                .andExpect(jsonPath("$.products[0].product_id", is("prod_mkt_001")))
                .andExpect(jsonPath("$.products[0].seller_picture", is("https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=150&w=150")))
                .andExpect(jsonPath("$.products[0].seller_picture_url", is("https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=150&w=150")))
                .andExpect(jsonPath("$.products[0].badge_type", is("other")))
                .andExpect(jsonPath("$.products[0].price", is(850.0)));
    }

    @Test
    void marketplaceWithTags_mixesProductsAndServices() throws Exception {
        mockMvc.perform(get("/api/marketplace/products")
                        .queryParam("tag_ids", "tag_endurance")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.count", greaterThanOrEqualTo(3)))
                .andExpect(jsonPath("$.products[0].item_type", is("product")))
                .andExpect(jsonPath("$.products[0].product_id", is("prod_mkt_001")))
                .andExpect(jsonPath("$.products[1].item_type", is("service")))
                .andExpect(jsonPath("$.products[1].service_id", is("svc_003")))
                .andExpect(jsonPath("$.products[1].is_physical", is(false)));
    }

    @Test
    void marketplaceWithSpotyou_ownerBadgeAndDistance_areApplied() throws Exception {
        mockMvc.perform(get("/api/marketplace/products")
                        .queryParam("spotyou_id", "tp_001")
                        .queryParam("user_lat", "48.8566")
                        .queryParam("user_lng", "2.3522")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.count", greaterThanOrEqualTo(2)))
                .andExpect(jsonPath("$.products[0].badge_type", is("owner")))
                .andExpect(jsonPath("$.products[0].badge_label", is("Créateur du SpotYou")))
                .andExpect(jsonPath("$.products[0].dist_from_spotyou", is(0.0)))
                .andExpect(jsonPath("$.products[0].dist_from_spotyou_fmt", is("0 m")))
                .andExpect(jsonPath("$.products[0].dist_from_user_fmt", is("0 m")))
                .andExpect(jsonPath("$.products[0].seller_stats.rating_count", greaterThanOrEqualTo(1)));
    }

    @Test
    void marketplaceSpotyouInvalid_returnsEmptyList() throws Exception {
        mockMvc.perform(get("/api/marketplace/products")
                        .queryParam("spotyou_id", "tp_unknown")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.count", is(0)))
                .andExpect(jsonPath("$.products", hasSize(0)));
    }

    @Test
    void marketplacePublic_withAuthHeader_stillWorksSameContract() throws Exception {
        mockMvc.perform(get("/api/marketplace/products")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.products", hasSize(2)))
                .andExpect(jsonPath("$.count", is(2)));
    }
}
