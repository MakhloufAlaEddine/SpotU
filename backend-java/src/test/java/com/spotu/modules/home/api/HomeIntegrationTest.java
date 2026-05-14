package com.spotu.modules.home.api;

import com.spotu.modules.auth.support.TestJwtTokens;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.notNullValue;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class HomeIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void nearestSector_nominal_returnsNearestPoint() throws Exception {
        mockMvc.perform(get("/api/home/nearest-sector")
                        .param("lat", "48.8566")
                        .param("lng", "2.3522"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lat", notNullValue()))
                .andExpect(jsonPath("$.lng", notNullValue()))
                .andExpect(jsonPath("$.distance_km", notNullValue()))
                .andExpect(jsonPath("$.spot_count", greaterThanOrEqualTo(1)));
    }

    @Test
    void nearestSector_withAuthExcludesOwnSpots_canReturnNull() throws Exception {
        jdbcTemplate.update("UPDATE tag_points SET user_id = 'user_private001', active = TRUE");

        mockMvc.perform(get("/api/home/nearest-sector")
                        .param("lat", "48.8566")
                        .param("lng", "2.3522")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(content().string("null"));
    }

    @Test
    void feed_nominal_withoutAuth_works() throws Exception {
        mockMvc.perform(get("/api/home/feed")
                        .param("lat", "48.8566")
                        .param("lng", "2.3522")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.spotyou").isArray())
                .andExpect(jsonPath("$.services").isArray())
                .andExpect(jsonPath("$.has_personalization", is(false)))
                .andExpect(jsonPath("$.actual_radius_km", notNullValue()));
    }

    @Test
    void feed_withoutCoordinates_returnsDataNoGeoFilter() throws Exception {
        mockMvc.perform(get("/api/home/feed")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.spotyou").isArray())
                .andExpect(jsonPath("$.services").isArray())
                .andExpect(jsonPath("$.actual_radius_km", is(50)));
    }

    @Test
    void feed_autoExpansion_reaches200kmWhenNeeded() throws Exception {
        jdbcTemplate.update("UPDATE tag_points SET active = FALSE");
        jdbcTemplate.update("UPDATE services SET active = FALSE");

        jdbcTemplate.update("""
                INSERT INTO tag_points (
                    point_id, user_id, title, description, precision, images, image_url, event_date, event_end_date,
                    event_schedule, schedule, domain_id, tag_ids, minimum_participants, maximum_participants,
                    latitude, longitude, visibility_type, cancelled, active, created_at
                ) VALUES
                ('tp_far_1', 'user_demo001', 'Far Spot 1', 'desc', '100m', '[]', NULL, NULL, NULL,
                 NULL, NULL, 'dom_sport', '[]', 1, 10, 1.4, 0.0, 'public', FALSE, TRUE, CURRENT_TIMESTAMP),
                ('tp_far_2', 'user_demo001', 'Far Spot 2', 'desc', '100m', '[]', NULL, NULL, NULL,
                 NULL, NULL, 'dom_sport', '[]', 1, 10, 1.5, 0.0, 'public', FALSE, TRUE, CURRENT_TIMESTAMP)
                """);
        jdbcTemplate.update("""
                INSERT INTO services (
                    service_id, coach_id, title, description, address, price, duration_min, location_description,
                    max_participants, tag_ids, domain_id, images, active, created_at, updated_at,
                    booking_approval_mode, allow_pay_later, pay_later_expiration_minutes
                ) VALUES (
                    'svc_far_1', 'user_demo001', 'Far service', 'desc', 'addr', 20.00, 60, 'loc',
                    5, '[]', 'dom_sport', '[]', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'manual_approval', TRUE, 1440
                )
                """);
        jdbcTemplate.update("""
                INSERT INTO service_locations (location_id, service_id, precision, description, latitude, longitude, location)
                VALUES ('loc_far_1', 'svc_far_1', 'exact', 'desc', 1.45, 0.0, 'POINT(0.0 1.45)')
                """);

        mockMvc.perform(get("/api/home/feed")
                        .param("lat", "0.0")
                        .param("lng", "0.0"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.actual_radius_km", is(200)))
                .andExpect(jsonPath("$.is_expanded", is(true)))
                .andExpect(jsonPath("$.total_count", greaterThanOrEqualTo(3)));
    }
}

