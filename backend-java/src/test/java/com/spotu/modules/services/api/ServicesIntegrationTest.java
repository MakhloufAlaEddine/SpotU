package com.spotu.modules.services.api;

import com.fasterxml.jackson.databind.ObjectMapper;
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

import java.sql.Timestamp;
import java.util.List;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.notNullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import java.util.Map;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class ServicesIntegrationTest {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void search_nominal_public_returnsEnrichedListWithEmptySlotsAndPackages() throws Exception {
        mockMvc.perform(get("/api/services").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(3)))
                .andExpect(jsonPath("$[0].slots", hasSize(0)))
                .andExpect(jsonPath("$[0].packages", hasSize(0)))
                .andExpect(jsonPath("$[0].is_owner", is(false)))
                .andExpect(jsonPath("$[0].coach.user_id").exists())
                .andExpect(jsonPath("$[0].tags[0].tag_id").exists())
                .andExpect(jsonPath("$[0].review_count").exists());
    }

    @Test
    void search_filterCoachId_works() throws Exception {
        mockMvc.perform(get("/api/services").queryParam("coach_id", "user_demo001").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].coach_id", is("user_demo001")))
                .andExpect(jsonPath("$[1].coach_id", is("user_demo001")));
    }

    @Test
    void search_validToken_excludesOwnServices() throws Exception {
        mockMvc.perform(get("/api/services")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].coach_id", is("user_admin001")));
    }

    @Test
    void search_invalidToken_ignored_no401() throws Exception {
        mockMvc.perform(get("/api/services")
                        .header("Authorization", "Bearer invalid.token.here")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(3)));
    }

    @Test
    void search_emptyList_returns200Array() throws Exception {
        mockMvc.perform(get("/api/services")
                        .queryParam("coach_id", "user_unknown")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void detail_nominal_noAuth_returnsSlotsAndPackagesAndNotOwner() throws Exception {
        mockMvc.perform(get("/api/services/svc_001").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.service_id", is("svc_001")))
                .andExpect(jsonPath("$.is_owner", is(false)))
                .andExpect(jsonPath("$.slots", hasSize(2)))
                .andExpect(jsonPath("$.packages", hasSize(1)))
                .andExpect(jsonPath("$.original_address").doesNotExist())
                .andExpect(jsonPath("$.locations[0].original_description").doesNotExist());
    }

    @Test
    void detail_ownerCoach_showsOriginalAddressFields() throws Exception {
        mockMvc.perform(get("/api/services/svc_001")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.is_owner", is(true)))
                .andExpect(jsonPath("$.original_address", is("10 Rue de la Paix, 75008 Paris, France")))
                .andExpect(jsonPath("$.locations[0].original_description", is("10 Rue de la Paix, 75008 Paris, France")));
    }

    @Test
    void detail_ownerAdmin_showsOwnerView() throws Exception {
        mockMvc.perform(get("/api/services/svc_001")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.is_owner", is(true)));
    }

    @Test
    void detail_notFound_returns404() throws Exception {
        mockMvc.perform(get("/api/services/svc_unknown").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("Service not found")));
    }

    @Test
    void mine_requiresAuth_andReturnsOwnerShape() throws Exception {
        mockMvc.perform(get("/api/services/mine").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(get("/api/services/mine")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].is_owner", is(true)))
                .andExpect(jsonPath("$[0].slots").isArray())
                .andExpect(jsonPath("$[0].packages").isArray());
    }

    @Test
    void saved_requiresAuth_andReturnsFlatDistinctFormat() throws Exception {
        mockMvc.perform(get("/api/services/saved").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(get("/api/services/saved")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].service_id").exists())
                .andExpect(jsonPath("$[0].coach.user_id").exists())
                .andExpect(jsonPath("$[0].available_slots").isNumber())
                .andExpect(jsonPath("$[0].tag_ids").doesNotExist())
                .andExpect(jsonPath("$[0].slots").doesNotExist())
                .andExpect(jsonPath("$[0].packages").doesNotExist());
    }

    @Test
    void deactivated_requiresAuth_andReturnsLifecycleFields() throws Exception {
        mockMvc.perform(get("/api/services/deactivated").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(get("/api/services/deactivated")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].service_id", is("svc_004")))
                .andExpect(jsonPath("$[0].deleted_at").exists())
                .andExpect(jsonPath("$[0].media_purge_scheduled_at").exists())
                .andExpect(jsonPath("$[0].days_until_media_purge").isNumber());
    }

    @Test
    void create_nominal_coach_returnsEnrichedService() throws Exception {
        String body = """
                {
                  "title":"Cours cardio avancé",
                  "description":"Description de test suffisamment longue",
                  "images":["https://img/new-1.jpg"],
                  "locations":[{"latitude":48.85,"longitude":2.35,"precision":"exact","description":"Paris"}]
                }
                """;
        mockMvc.perform(post("/api/services")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.service_id").exists())
                .andExpect(jsonPath("$.coach_id", is("user_demo001")))
                .andExpect(jsonPath("$.title", is("Cours cardio avancé")))
                .andExpect(jsonPath("$.booking_approval_mode").exists())
                .andExpect(jsonPath("$.is_saved", is(false)));
    }

    @Test
    void create_invalidTitle_returns422PydanticShape() throws Exception {
        mockMvc.perform(post("/api/services")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"abc\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code", is("VALIDATION_ERROR")))
                .andExpect(jsonPath("$.detail", hasSize(1)))
                .andExpect(jsonPath("$.detail[0].loc[1]", is("title")));
    }

    @Test
    void update_patch_owner_updatesWithoutWipingImagesWhenMissing() throws Exception {
        mockMvc.perform(patch("/api/services/svc_001")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Titre patch\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title", is("Titre patch")))
                .andExpect(jsonPath("$.images", hasSize(1)));
    }

    @Test
    void update_patch_nonOwner_forbidden() throws Exception {
        mockMvc.perform(patch("/api/services/svc_001")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"KO\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void delete_owner_withActiveBookings_returns409() throws Exception {
        mockMvc.perform(delete("/api/services/svc_001")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("réservation(s) active(s)")));
    }

    @Test
    void delete_admin_bypassActiveBookings_softDeletes() throws Exception {
        mockMvc.perform(delete("/api/services/svc_001")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.media_purge_scheduled_at", notNullValue()));
    }

    @Test
    void reactivate_deleted_service_returnsRequiresMediaReuploadFlag() throws Exception {
        mockMvc.perform(post("/api/services/svc_004/reactivate")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.reactivated", is(true)))
                .andExpect(jsonPath("$.service_id", is("svc_004")))
                .andExpect(jsonPath("$.requires_media_reupload").exists());
    }

    @Test
    void create_withSlots_recurringSingleAvailability_persistsAndReturnsInDetail() throws Exception {
        String body = """
                {
                  "title":"Service avec slots",
                  "description":"Description suffisante pour la création de service",
                  "locations":[{"latitude":48.85,"longitude":2.35,"precision":"exact","description":"Paris centre"}],
                  "slots":[
                    {"slot_type":"single","location_index":0,"slot_date":"2099-12-31","start_time":"09:00","end_time":"10:00"},
                    {"slot_type":"recurring","location_index":0,"days_of_week":[1,3,5],"start_time":"18:00","end_time":"19:00"},
                    {"slot_type":"availability","location_index":0,"days_of_week":[2],"start_time":"12:00","end_time":"13:00"}
                  ]
                }
                """;
        String json = mockMvc.perform(post("/api/services")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.service_id").exists())
                .andExpect(jsonPath("$.slots", hasSize(3)))
                .andExpect(jsonPath("$.slots[0].slot_status", is("available")))
                .andReturn().getResponse().getContentAsString();

        String serviceId = String.valueOf(objectMapper.readValue(json, Map.class).get("service_id"));
        mockMvc.perform(get("/api/services/" + serviceId).accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slots", hasSize(3)));
    }

    @Test
    void update_slotsAbsent_keepsExistingSlots() throws Exception {
        mockMvc.perform(patch("/api/services/svc_001")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Keep slots\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slots", hasSize(2)));
    }

    @Test
    void update_slotsEmptyArray_wipesAllSlots() throws Exception {
        mockMvc.perform(put("/api/services/svc_001")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slots\":[]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slots", hasSize(0)));
    }

    @Test
    void update_slotsList_replacesAllSlots() throws Exception {
        String body = """
                {
                  "slots":[
                    {"slot_type":"single","slot_date":"2099-10-10","start_time":"07:00","end_time":"08:00"}
                  ]
                }
                """;
        mockMvc.perform(put("/api/services/svc_001")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slots", hasSize(1)))
                .andExpect(jsonPath("$.slots[0].slot_type", is("single")))
                .andExpect(jsonPath("$.slots[0].slot_status", is("available")));
    }

    @Test
    void create_slotLocationIndexOutOfBounds_fallsBackToFirstLocation_andRawScheduleIgnored() throws Exception {
        String body = """
                {
                  "title":"Service fallback index",
                  "description":"Description suffisante pour fallback index location",
                  "locations":[
                    {"latitude":48.85,"longitude":2.35,"precision":"exact","description":"L0"}
                  ],
                  "slots":[
                    {
                      "slot_type":"recurring",
                      "location_index":99,
                      "raw_schedule":{"unexpected":"data"},
                      "days_of_week":[1],
                      "start_time":"11:00",
                      "end_time":"12:00"
                    }
                  ]
                }
                """;
        mockMvc.perform(post("/api/services")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slots", hasSize(1)))
                .andExpect(jsonPath("$.slots[0].location_id").isString())
                .andExpect(jsonPath("$.slots[0].slot_status", is("available")));
    }

    @Test
    void create_withPackages_persistsAndComputesMinPriceWhenPriceMissing() throws Exception {
        String body = """
                {
                  "title":"Service packages",
                  "description":"Description packages creation flow pour test",
                  "packages":[
                    {
                      "type_id":"basic",
                      "type_label":"Basic",
                      "price":30.0,
                      "slots":[{"slot_date":"2099-07-01","start_time":"09:00","end_time":"10:00"}]
                    },
                    {
                      "type_id":"pro",
                      "type_label":"Pro",
                      "price":15.0,
                      "slots":[]
                    }
                  ]
                }
                """;
        mockMvc.perform(post("/api/services")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.price", is(15.0)))
                .andExpect(jsonPath("$.packages", hasSize(2)))
                .andExpect(jsonPath("$.packages[0].slots").isArray())
                .andExpect(jsonPath("$.slots[0].package_id").exists())
                .andExpect(jsonPath("$.slots[0].location_id").value(org.hamcrest.Matchers.nullValue()));
    }

    @Test
    void put_withPackages_isIgnoredSilently() throws Exception {
        String body = """
                {
                  "title":"Updated with ignored packages",
                  "packages":[{"type_id":"x","type_label":"X","price":99.0}]
                }
                """;
        mockMvc.perform(put("/api/services/svc_001")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title", is("Updated with ignored packages")))
                .andExpect(jsonPath("$.packages", hasSize(1)))
                .andExpect(jsonPath("$.packages[0].type_id", is("pkg_type_1")));
    }

    @Test
    void replaceGlobalSlots_stillClearsPackageSlots_pythonParity() throws Exception {
        String createBody = """
                {
                  "title":"Service package wipe",
                  "description":"Description suffisante pour test wipe package slots",
                  "packages":[
                    {
                      "type_id":"pack_a",
                      "type_label":"Pack A",
                      "price":20.0,
                      "slots":[{"slot_date":"2099-06-01","start_time":"08:00","end_time":"09:00"}]
                    }
                  ]
                }
                """;
        String json = mockMvc.perform(post("/api/services")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.packages[0].slots", hasSize(1)))
                .andReturn().getResponse().getContentAsString();
        String serviceId = String.valueOf(objectMapper.readValue(json, Map.class).get("service_id"));

        mockMvc.perform(put("/api/services/" + serviceId)
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slots\":[]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slots", hasSize(0)))
                .andExpect(jsonPath("$.packages", hasSize(1)))
                .andExpect(jsonPath("$.packages[0].slots", hasSize(0)));
    }

    @Test
    void save_nominal_and_unsave_nominal_roundTripWithSavedList() throws Exception {
        mockMvc.perform(post("/api/services/svc_003/save")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.is_saved", is(true)));

        mockMvc.perform(get("/api/services/saved")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].service_id", is("svc_003")));

        mockMvc.perform(delete("/api/services/svc_003/unsave")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.is_saved", is(false)));

        mockMvc.perform(get("/api/services/saved")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void save_idempotent_keepsSavedAt_andInactiveReturns404() throws Exception {
        mockMvc.perform(post("/api/services/svc_003/save")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk());
        Timestamp t1 = jdbcTemplate.queryForObject(
                "SELECT saved_at FROM service_saves WHERE service_id = ? AND user_id = ?",
                Timestamp.class,
                "svc_003", "user_private001"
        );

        mockMvc.perform(post("/api/services/svc_003/save")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.is_saved", is(true)));
        Timestamp t2 = jdbcTemplate.queryForObject(
                "SELECT saved_at FROM service_saves WHERE service_id = ? AND user_id = ?",
                Timestamp.class,
                "svc_003", "user_private001"
        );
        org.junit.jupiter.api.Assertions.assertEquals(t1, t2);

        mockMvc.perform(post("/api/services/svc_004/save")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("Service not found")));
    }

    @Test
    void unsave_silent_whenMissing_and_requiresAuth() throws Exception {
        mockMvc.perform(delete("/api/services/svc_unknown/unsave")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.is_saved", is(false)));

        mockMvc.perform(post("/api/services/svc_003/save"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(delete("/api/services/svc_003/unsave"))
                .andExpect(status().isUnauthorized());
    }
}
