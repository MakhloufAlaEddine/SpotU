package com.spotu.modules.spotyou.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.modules.auth.support.TestJwtTokens;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class TagPointWriteIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void create_nominal_and_owner_membership() throws Exception {
        String body = """
                {
                  "title": "Spot créé test S28",
                  "description": "desc",
                  "latitude": 48.9,
                  "longitude": 2.4,
                  "precision": "exact",
                  "tag_ids": ["tag_endurance"],
                  "domain_id": "dom_sport",
                  "images": []
                }
                """;
        String resp = mockMvc.perform(post("/api/tag-points")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title", is("Spot créé test S28")))
                .andExpect(jsonPath("$.is_owner", is(true)))
                .andReturn().getResponse().getContentAsString();
        String pid = objectMapper.readTree(resp).path("point_id").asText();
        Integer n = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM spot_you_members WHERE spot_you_id = ? AND user_id = ? AND status = 'accepted'",
                Integer.class,
                pid, "user_demo001"
        );
        Assertions.assertNotNull(n);
        Assertions.assertTrue(n >= 1);
    }

    @Test
    void create_empty_tag_ids_returns400() throws Exception {
        String body = """
                {
                  "title": "X",
                  "latitude": 48.9,
                  "longitude": 2.4,
                  "tag_ids": [],
                  "domain_id": "dom_sport"
                }
                """;
        mockMvc.perform(post("/api/tag-points")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", is("Au moins un tag est requis.")));
    }

    @Test
    void create_precision_100m_stores_offset_coordinates() throws Exception {
        String body = """
                {
                  "title": "Spot flou",
                  "latitude": 48.0,
                  "longitude": 2.0,
                  "precision": "100m",
                  "tag_ids": ["tag_endurance"],
                  "domain_id": "dom_sport",
                  "images": []
                }
                """;
        String resp = mockMvc.perform(post("/api/tag-points")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode root = objectMapper.readTree(resp);
        double lat = root.path("latitude").asDouble();
        double lng = root.path("location").path("coordinates").get(0).asDouble();
        Assertions.assertNotEquals(48.0, lat, 1e-6);
        Assertions.assertNotEquals(2.0, lng, 1e-6);
    }

    @Test
    void update_title_as_owner() throws Exception {
        String body = "{\"title\":\"Titre modifié S28\"}";
        mockMvc.perform(put("/api/tag-points/tp_001")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title", is("Titre modifié S28")))
                .andExpect(jsonPath("$.is_owner", is(true)));
    }

    @Test
    void update_as_non_owner_returns403() throws Exception {
        String body = "{\"title\":\"Hack\"}";
        mockMvc.perform(put("/api/tag-points/tp_001")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail", is("Not authorized")));
    }

    @Test
    void update_empty_body_returns_current() throws Exception {
        mockMvc.perform(put("/api/tag-points/tp_002")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.point_id", is("tp_002")));
    }

    @Test
    void admin_can_update_any_spotyou() throws Exception {
        String body = "{\"title\":\"Modifié par admin\"}";
        mockMvc.perform(put("/api/tag-points/tp_001")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title", is("Modifié par admin")));
    }

    @Test
    void patch_new_date_toggle() throws Exception {
        mockMvc.perform(patch("/api/tag-points/tp_001/new-date")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.new_date_coming", is(true)));
        mockMvc.perform(patch("/api/tag-points/tp_001/new-date")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.new_date_coming", is(false)));
    }

    @Test
    void create_without_token_returns401() throws Exception {
        mockMvc.perform(post("/api/tag-points")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"X\",\"latitude\":1,\"longitude\":2,\"tag_ids\":[\"tag_endurance\"],\"domain_id\":\"dom_sport\"}")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());
    }
}
