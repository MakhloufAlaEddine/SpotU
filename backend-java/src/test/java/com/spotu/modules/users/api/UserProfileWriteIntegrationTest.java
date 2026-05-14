package com.spotu.modules.users.api;

import com.spotu.modules.auth.support.TestJwtTokens;
import com.spotu.modules.uploads.service.FileStorageService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.is;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class UserProfileWriteIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @MockBean
    private FileStorageService fileStorageService;

    @Test
    void updateProfile_partialAndClearable_nominal() throws Exception {
        mockMvc.perform(put("/api/users/profile")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"  Nouveau Nom  ","bio":null,"coach_tags":["tag_hatha"],"show_phone":true}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name", is("Nouveau Nom")))
                .andExpect(jsonPath("$.bio").isEmpty())
                .andExpect(jsonPath("$.show_phone", is(true)));

        String name = jdbcTemplate.queryForObject(
                "SELECT name FROM users WHERE user_id='user_private001'",
                String.class
        );
        assertThat(name).isEqualTo("Nouveau Nom");
    }

    @Test
    void becomeCoach_alreadyCoach_returns400() throws Exception {
        mockMvc.perform(post("/api/users/become-coach")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", is("Already a coach or admin")));
    }

    @Test
    void patchCover_ownershipMismatch_returns403() throws Exception {
        mockMvc.perform(patch("/api/users/user_demo001/cover")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"cover_picture":"https://x/new.jpg"}
                                """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail", is("Accès refusé.")));
    }

    @Test
    void uploadImage_successJpeg_returnsUrlAndFilename() throws Exception {
        when(fileStorageService.normalizeCategory(eq("profiles"))).thenReturn("profiles");
        when(fileStorageService.uploadWithFallback(any(), eq("profiles"), eq("jpg"), any()))
                .thenReturn(new FileStorageService.UploadResult(
                        "https://images.winek.app/profiles/img_ok.jpg",
                        "img_ok.jpg"
                ));

        byte[] jpeg = new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08};
        MockMultipartFile file = new MockMultipartFile("file", "a.jpg", "image/jpeg", jpeg);

        mockMvc.perform(multipart("/api/upload-image")
                        .file(file)
                        .param("category", "profiles")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url", is("https://images.winek.app/profiles/img_ok.jpg")))
                .andExpect(jsonPath("$.filename", is("img_ok.jpg")));
    }

    @Test
    void uploadImage_invalidMagicBytes_returns415() throws Exception {
        byte[] bad = "not-image-content".getBytes();
        MockMultipartFile file = new MockMultipartFile("file", "a.txt", "text/plain", bad);

        mockMvc.perform(multipart("/api/upload-image")
                        .file(file)
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isUnsupportedMediaType());
    }

    @Test
    void pushToken_upsertAndDelete_nominal() throws Exception {
        mockMvc.perform(post("/api/push-token")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"token":"ExponentPushToken[test123]","platform":"expo"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("registered")));

        mockMvc.perform(post("/api/push-token")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"token":"ExponentPushToken[test123]","platform":"expo"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("updated")));

        mockMvc.perform(delete("/api/push-token")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"token":"ExponentPushToken[test123]","platform":"expo"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("unregistered")));
    }
}

