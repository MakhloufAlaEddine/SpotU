package com.spotu.modules.referential.api;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class ReferentialIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void domains_default_returnsOnlyActive_sorted() throws Exception {
        mockMvc.perform(get("/api/domains").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].domain_id", is("dom_sport")))
                .andExpect(jsonPath("$[0].active", is(true)));
    }

    @Test
    void domains_includeInactive_true_returnsAll() throws Exception {
        mockMvc.perform(get("/api/domains")
                        .queryParam("include_inactive", "true")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)));
    }

    @Test
    void domains_invalidToken_ignored_still200() throws Exception {
        mockMvc.perform(get("/api/domains")
                        .header("Authorization", "Bearer invalid.token")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)));
    }

    @Test
    void categories_nominal_grouped_tags_linkedCategoryHidden() throws Exception {
        mockMvc.perform(get("/api/tags/categories").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(3)))
                .andExpect(jsonPath("$[0].category_id", is("cat_product")))
                .andExpect(jsonPath("$[0].tags", hasSize(0)))
                .andExpect(jsonPath("$[1].category_id", is("cat_run")))
                .andExpect(jsonPath("$[1].tags", hasSize(1)))
                .andExpect(jsonPath("$[1].tags[0].tag_id", is("tag_endurance")))
                .andExpect(jsonPath("$[1].tags[0].linked_category_id").doesNotExist());
    }

    @Test
    void categories_filters_domain_and_entity_type_work() throws Exception {
        mockMvc.perform(get("/api/tags/categories")
                        .queryParam("domain_id", "dom_sport")
                        .queryParam("entity_type", "service")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].entity_type", is("service")))
                .andExpect(jsonPath("$[1].entity_type", is("service")));
    }

    @Test
    void categories_empty_returns200Array() throws Exception {
        mockMvc.perform(get("/api/tags/categories")
                        .queryParam("domain_id", "dom_unknown")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void tags_noFilter_branchC_returnsActiveOnly_withLimit() throws Exception {
        mockMvc.perform(get("/api/tags").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].name", is("endurance")))
                .andExpect(jsonPath("$[1].name", is("hatha")));
    }

    @Test
    void tags_domainOnly_branchB_works() throws Exception {
        mockMvc.perform(get("/api/tags")
                        .queryParam("domain_id", "dom_sport")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)));
    }

    @Test
    void tags_categoryOrEntity_branchA_distinct_works() throws Exception {
        mockMvc.perform(get("/api/tags")
                        .queryParam("category_id", "cat_run")
                        .queryParam("entity_type", "service")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].tag_id", is("tag_endurance")));
    }

    @Test
    void tags_unknownFilter_returnsEmpty200() throws Exception {
        mockMvc.perform(get("/api/tags")
                        .queryParam("category_id", "cat_unknown")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void cors_allowedOrigin_returnsExplicitOriginAndCredentials() throws Exception {
        mockMvc.perform(get("/api/domains")
                        .header("Origin", "http://localhost:3000")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:3000"))
                .andExpect(header().string("Access-Control-Allow-Credentials", "true"));
    }
}
