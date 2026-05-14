package com.spotu.modules.marketplace.api;

import com.spotu.modules.auth.support.TestJwtTokens;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = {"/test-data-users.sql", "/test-data-products-s40.sql"}, executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class ProductLifecycleIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void deleteProduct_nominalOwner() throws Exception {
        mockMvc.perform(delete("/api/products/prod_s40_active_owner")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok", is(true)))
                .andExpect(jsonPath("$.media_purge_scheduled_at").exists());
    }

    @Test
    void deleteProduct_nonOwner_returns404ErrorFormat() throws Exception {
        mockMvc.perform(delete("/api/products/prod_s40_active_other")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error", is("Produit introuvable ou non autorisé.")));
    }

    @Test
    void reactivateProduct_nominalOwner_pendingOnlyCancelled() throws Exception {
        mockMvc.perform(post("/api/products/prod_s40_deleted_owner/reactivate")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok", is(true)))
                .andExpect(jsonPath("$.reactivated", is(true)))
                .andExpect(jsonPath("$.product_id", is("prod_s40_deleted_owner")))
                .andExpect(jsonPath("$.media_purged", is(false)))
                .andExpect(jsonPath("$.requires_media_reupload", is(false)));

        Integer pendingCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM pending_file_deletions WHERE entity_id='prod_s40_deleted_owner' AND status='pending'",
                Integer.class
        );
        Integer processingCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM pending_file_deletions WHERE entity_id='prod_s40_deleted_owner' AND status='processing'",
                Integer.class
        );
        org.junit.jupiter.api.Assertions.assertEquals(0, pendingCount);
        org.junit.jupiter.api.Assertions.assertEquals(1, processingCount);
    }

    @Test
    void reactivateProduct_mediaPurged_requiresReupload() throws Exception {
        mockMvc.perform(post("/api/products/prod_s40_deleted_purged/reactivate")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.media_purged", is(true)))
                .andExpect(jsonPath("$.requires_media_reupload", is(true)));
    }

    @Test
    void reactivateProduct_nonOwnerNonAdmin_returns403Detail() throws Exception {
        mockMvc.perform(post("/api/products/prod_s40_active_other/reactivate")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail", is("Ce produit n'est pas supprimé")));
    }

    @Test
    void reactivateProduct_notFound_returns404Detail() throws Exception {
        mockMvc.perform(post("/api/products/prod_s40_notfound/reactivate")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("Produit introuvable")));
    }

    @Test
    void reactivateProduct_forbidden_otherSellerDeleted() throws Exception {
        jdbcTemplate.update("""
                UPDATE marketplace_products
                SET status='deleted', deleted_at=CURRENT_TIMESTAMP, deleted_by='user_demo001'
                WHERE product_id='prod_s40_active_other'
                """);
        mockMvc.perform(post("/api/products/prod_s40_active_other/reactivate")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail", is("Non autorisé")));
    }
}
