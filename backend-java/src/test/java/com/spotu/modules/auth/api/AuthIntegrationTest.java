package com.spotu.modules.auth.api;

import com.spotu.modules.auth.service.EmergentOAuthClient;
import com.spotu.modules.auth.support.TestJwtTokens;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.is;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AuthIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @MockBean
    private EmergentOAuthClient emergentOAuthClient;

    @Test
    void register_nominal_returnsUserAndToken() throws Exception {
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"NEW@EXAMPLE.COM","password":"secret12","name":" Jean ","language":"fr"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.email", is("new@example.com")))
                .andExpect(jsonPath("$.user.role", is("user")))
                .andExpect(jsonPath("$.token", containsString(".")));
    }

    @Test
    void register_duplicate_returns400() throws Exception {
        String hash = new BCryptPasswordEncoder(12).encode("secret12");
        jdbcTemplate.update(
                "INSERT INTO users (user_id, email, password_hash, name, role, language, coach_tags) VALUES (?,?,?,?,?,?,?)",
                "user_dup_auth_1", "dup@example.com", hash, "Dup", "user", "fr", "[]"
        );
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"dup@example.com","password":"secret12","name":"Dup"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", is("Email already registered")));
    }

    @Test
    void login_badPassword_returns401InvalidCredentials() throws Exception {
        String hash = new BCryptPasswordEncoder(12).encode("secret12");
        jdbcTemplate.update(
                "INSERT INTO users (user_id, email, password_hash, name, role, language, coach_tags) VALUES (?,?,?,?,?,?,?)",
                "user_login_1", "login@example.com", hash, "Login", "user", "fr", "[]"
        );
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"login@example.com","password":"wrong-pass"}
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("Invalid credentials")));
    }

    @Test
    void me_invalidToken_returns401() throws Exception {
        mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer invalid.token.value")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("Invalid token")));
    }

    @Test
    void google_nominal_existingUser_updatesAndReturnsToken() throws Exception {
        jdbcTemplate.update(
                "INSERT INTO users (user_id, email, name, role, language, coach_tags) VALUES (?,?,?,?,?,?)",
                "user_google_1", "google@example.com", "Old Name", "user", "fr", "[]"
        );
        when(emergentOAuthClient.fetchSession("sess_ok")).thenReturn(Map.of(
                "email", "GOOGLE@example.com",
                "name", "New Name",
                "picture", "https://example.com/pic.jpg"
        ));

        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"session_id":"sess_ok"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.user_id", is("user_google_1")))
                .andExpect(jsonPath("$.user.name", is("New Name")))
                .andExpect(jsonPath("$.token", containsString(".")));
    }

    @Test
    void google_invalidPayload_returns401() throws Exception {
        when(emergentOAuthClient.fetchSession("sess_bad"))
                .thenThrow(new com.spotu.error.ApiAuthException("Invalid Google session"));

        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"session_id":"sess_bad"}
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("Invalid Google session")));
    }

    @Test
    void changePassword_nominal_thenLoginWithNewPassword() throws Exception {
        String hash = new BCryptPasswordEncoder(12).encode("oldpass1");
        jdbcTemplate.update("UPDATE users SET email=?, password_hash=? WHERE user_id=?", "pwd@example.com", hash, "user_private001");

        mockMvc.perform(put("/api/auth/change-password")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"current_password":"oldpass1","new_password":"newpass2"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)));

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"pwd@example.com","password":"newpass2"}
                                """))
                .andExpect(status().isOk());
    }
}
