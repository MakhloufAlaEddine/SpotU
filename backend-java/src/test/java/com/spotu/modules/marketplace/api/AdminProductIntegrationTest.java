package com.spotu.modules.marketplace.api;

import com.spotu.modules.auth.support.TestJwtTokens;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = {"/test-data-users.sql", "/test-data-products-s41.sql"}, executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class AdminProductIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void pending_nominal_fifo_andQualityScore() throws Exception {
        mockMvc.perform(get("/api/admin/products/pending")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.count", is(2)))
                .andExpect(jsonPath("$.products", hasSize(2)))
                .andExpect(jsonPath("$.products[0].product_id", is("prod_s41_pending_old")))
                .andExpect(jsonPath("$.products[0].quality_score", is(100)));
    }

    @Test
    void detail_nominal_selectStarLike_andSellerEmail() throws Exception {
        mockMvc.perform(get("/api/admin/products/prod_s41_pending_old")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.product_id", is("prod_s41_pending_old")))
                .andExpect(jsonPath("$.seller_email").exists())
                .andExpect(jsonPath("$.quality_score", is(100)));
    }

    @Test
    void nonAdmin_forbidden_formatDetail() throws Exception {
        mockMvc.perform(get("/api/admin/products/pending")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code", is("FORBIDDEN")))
                .andExpect(jsonPath("$.detail", is("Admin only")));
    }

    @Test
    void detail_notFound_formatError() throws Exception {
        mockMvc.perform(get("/api/admin/products/prod_s41_unknown")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code", is("PRODUCT_NOT_FOUND")))
                .andExpect(jsonPath("$.error", is("Produit introuvable.")));
    }

    @Test
    void approve_nominal_updatesAndNotifies() throws Exception {
        mockMvc.perform(post("/api/admin/products/prod_s41_pending_old/approve")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"comment\":\"Validé\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok", is(true)))
                .andExpect(jsonPath("$.status", is("active")));

        String statusVal = jdbcTemplate.queryForObject(
                "SELECT status FROM marketplace_products WHERE product_id='prod_s41_pending_old'",
                String.class
        );
        String notifType = jdbcTemplate.queryForObject(
                "SELECT type FROM notifications ORDER BY created_at DESC LIMIT 1",
                String.class
        );
        org.junit.jupiter.api.Assertions.assertEquals("active", statusVal);
        org.junit.jupiter.api.Assertions.assertEquals("product_approved", notifType);
    }

    @Test
    void reject_nominal_setsBothReasonAndAdminComment_sameValue() throws Exception {
        mockMvc.perform(post("/api/admin/products/prod_s41_pending_old/reject")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"comment\":\"Photo floue\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok", is(true)))
                .andExpect(jsonPath("$.status", is("rejected")));

        String rejection = jdbcTemplate.queryForObject(
                "SELECT rejection_reason FROM marketplace_products WHERE product_id='prod_s41_pending_old'",
                String.class
        );
        String adminComment = jdbcTemplate.queryForObject(
                "SELECT admin_comment FROM marketplace_products WHERE product_id='prod_s41_pending_old'",
                String.class
        );
        org.junit.jupiter.api.Assertions.assertEquals("Photo floue", rejection);
        org.junit.jupiter.api.Assertions.assertEquals("Photo floue", adminComment);
    }

    @Test
    void approve_deletedProduct_allowed_pythonAnomaly() throws Exception {
        mockMvc.perform(post("/api/admin/products/prod_s41_deleted/approve")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("active")));
    }
}
