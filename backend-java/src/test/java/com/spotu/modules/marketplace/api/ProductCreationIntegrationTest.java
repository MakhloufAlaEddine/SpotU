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
@Sql(scripts = {"/test-data-users.sql", "/test-data-products-s39.sql"}, executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class ProductCreationIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void postProducts_nominalCreate_ok() throws Exception {
        mockMvc.perform(post("/api/products")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "title":"Produit neuf",
                                  "description":"Description produit vraiment suffisamment longue pour passer la validation minimale.",
                                  "product_type":"rental",
                                  "price":"12,50",
                                  "image_urls":["https://img/new1.jpg"],
                                  "tag_ids":["tag_endurance"],
                                  "pricing_modes":["day"]
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.product_id").exists())
                .andExpect(jsonPath("$.status", is("draft")));
    }

    @Test
    void postProducts_invalidPendingReview_returns422ErrorAndDetails() throws Exception {
        mockMvc.perform(post("/api/products")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "status":"pending_review",
                                  "title":"Produit incomplet",
                                  "description":"Description volontairement assez longue pour passer la validation minimale des 30 caractères.",
                                  "product_type":"sale",
                                  "image_urls":[]
                                }
                                """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error", is("La catégorie du matériel est obligatoire.")))
                .andExpect(jsonPath("$.details", hasSize(6)));
    }

    @Test
    void postProducts_badRequest400_formatError() throws Exception {
        mockMvc.perform(post("/api/products")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"", "description":"Description suffisamment longue pour dépasser trente caractères.", "product_type":"rental"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("PRODUCT_BAD_REQUEST")))
                .andExpect(jsonPath("$.error", is("Le titre est obligatoire.")));
    }

    @Test
    void postProducts_forbiddenDowngrade_returns403Detail() throws Exception {
        mockMvc.perform(post("/api/products")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "product_id":"prod_s39_owner_002",
                                  "status":"draft",
                                  "title":"Tapis yoga",
                                  "description":"Description longue du tapis yoga avec suffisamment de détails pour dépasser 30 caractères.",
                                  "product_type":"sale"
                                }
                                """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code", is("FORBIDDEN")))
                .andExpect(jsonPath("$.detail", is("Impossible de repasser en brouillon : ce produit a déjà été soumis ou validé.")));
    }

    @Test
    void getMine_nominal() throws Exception {
        mockMvc.perform(get("/api/products/mine")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.count", is(2)))
                .andExpect(jsonPath("$.products", hasSize(2)))
                .andExpect(jsonPath("$.products[0].product_id", is("prod_s39_owner_002")));
    }

    @Test
    void getDetail_owner_ok() throws Exception {
        mockMvc.perform(get("/api/products/prod_s39_owner_001/detail")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.product_id", is("prod_s39_owner_001")))
                .andExpect(jsonPath("$.tag_ids[0]", is("tag_endurance")))
                .andExpect(jsonPath("$.image_urls[0]", is("https://img/s39/cover1.jpg")));
    }

    @Test
    void getDetail_forbiddenAsNotFound_errorFormat() throws Exception {
        mockMvc.perform(get("/api/products/prod_s39_other_001/detail")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error", is("Produit introuvable ou accès refusé.")));
    }

    @Test
    void postProducts_arraysPersistedAsJsonStrings() throws Exception {
        mockMvc.perform(post("/api/products")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "product_id":"prod_s39_arrays",
                                  "title":"Arrays test",
                                  "description":"Description valide et suffisamment longue pour vérifier les colonnes array/json.",
                                  "product_type":"rental",
                                  "pricing_modes":["day","session"],
                                  "image_urls":["https://img/a.jpg","https://img/b.jpg"],
                                  "tag_ids":["tag_endurance","tag_hatha"],
                                  "related_spotyou_ids":["tp_001"],
                                  "delivery_modes":["local_pickup"]
                                }
                                """))
                .andExpect(status().isOk());

        String pricingModes = jdbcTemplate.queryForObject(
                "SELECT pricing_modes FROM marketplace_products WHERE product_id='prod_s39_arrays'",
                String.class
        );
        String tagIds = jdbcTemplate.queryForObject(
                "SELECT tag_ids FROM marketplace_products WHERE product_id='prod_s39_arrays'",
                String.class
        );
        org.junit.jupiter.api.Assertions.assertEquals("[\"day\",\"session\"]", pricingModes);
        org.junit.jupiter.api.Assertions.assertEquals("[\"tag_endurance\",\"tag_hatha\"]", tagIds);
    }
}
