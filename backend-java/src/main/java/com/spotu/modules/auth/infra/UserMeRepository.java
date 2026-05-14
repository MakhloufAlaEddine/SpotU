package com.spotu.modules.auth.infra;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.support.PythonIsoTimestamps;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Accès DB auth (projection USER_FIELDS identique à auth_utils.py).
 */
@Repository
public class UserMeRepository {

    public static final String USER_FIELDS = """
            user_id, email, name, role, language, picture, bio, phone,
            is_coach_verified, coach_tags, show_phone, show_reviews,
            created_at, updated_at, sports_level, goals, user_roles, onboarding_done
            """;

    private static final String SELECT_USER_BY_ID = "SELECT " + USER_FIELDS + " FROM users WHERE user_id = ?";
    private static final String SELECT_USER_BY_EMAIL = "SELECT " + USER_FIELDS + " FROM users WHERE email = ?";

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public UserMeRepository(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    public Optional<CurrentUserDto> findByUserId(String userId) {
        return findUserMapByUserId(userId).map(this::toCurrentUserDto);
    }

    public Optional<Map<String, Object>> findUserMapByUserId(String userId) {
        List<Map<String, Object>> rows = jdbcTemplate.query(SELECT_USER_BY_ID, this::mapUserRow, userId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<Map<String, Object>> findUserMapByEmail(String email) {
        List<Map<String, Object>> rows = jdbcTemplate.query(SELECT_USER_BY_EMAIL, this::mapUserRow, email);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<String> findUserIdByEmail(String email) {
        List<String> rows = jdbcTemplate.query(
                "SELECT user_id FROM users WHERE email = ? LIMIT 1",
                (rs, rn) -> rs.getString("user_id"),
                email
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<CredentialsRow> findCredentialsByEmail(String email) {
        List<CredentialsRow> rows = jdbcTemplate.query(
                "SELECT user_id, password_hash, role FROM users WHERE email = ? LIMIT 1",
                (rs, rn) -> new CredentialsRow(
                        rs.getString("user_id"),
                        rs.getString("password_hash"),
                        rs.getString("role")
                ),
                email
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public void insertLocalUser(
            String userId,
            String email,
            String passwordHash,
            String name,
            String language
    ) {
        jdbcTemplate.update(
                """
                        INSERT INTO users (user_id, email, password_hash, name, role, language, coach_tags)
                        VALUES (?, ?, ?, ?, 'user', ?, ?)
                        """,
                userId, email, passwordHash, name, language, "[]"
        );
    }

    public void insertGoogleUser(
            String userId,
            String email,
            String name,
            String picture
    ) {
        jdbcTemplate.update(
                """
                        INSERT INTO users (user_id, email, name, picture, role, language, coach_tags)
                        VALUES (?, ?, ?, ?, 'user', 'fr', ?)
                        """,
                userId, email, name, picture, "[]"
        );
    }

    public void updateGoogleIdentity(String email, String name, String picture) {
        jdbcTemplate.update(
                "UPDATE users SET name = ?, picture = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?",
                name, picture, email
        );
    }

    public Optional<String> findPasswordHashByUserId(String userId) {
        List<String> rows = jdbcTemplate.query(
                "SELECT password_hash FROM users WHERE user_id = ? LIMIT 1",
                (rs, rn) -> rs.getString("password_hash"),
                userId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public void updatePasswordHash(String userId, String newPasswordHash) {
        jdbcTemplate.update(
                "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
                newPasswordHash, userId
        );
    }

    private Map<String, Object> mapUserRow(ResultSet rs, int rowNum) throws SQLException {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("user_id", rs.getString("user_id"));
        m.put("email", rs.getString("email"));
        m.put("name", rs.getString("name"));
        m.put("role", rs.getString("role"));
        m.put("language", rs.getString("language"));
        m.put("picture", rs.getString("picture"));
        m.put("bio", rs.getString("bio"));
        m.put("phone", rs.getString("phone"));
        m.put("is_coach_verified", readNullableBoolean(rs, "is_coach_verified"));
        m.put("coach_tags", readStringList(rs.getString("coach_tags")));
        m.put("show_phone", rs.getBoolean("show_phone"));
        m.put("show_reviews", rs.getBoolean("show_reviews"));
        m.put("created_at", PythonIsoTimestamps.fromTimestamp(rs.getTimestamp("created_at")));
        m.put("updated_at", PythonIsoTimestamps.fromTimestamp(rs.getTimestamp("updated_at")));
        m.put("sports_level", rs.getString("sports_level"));
        m.put("goals", readObjectList(rs.getString("goals")));
        m.put("user_roles", readObjectList(rs.getString("user_roles")));
        m.put("onboarding_done", readNullableBoolean(rs, "onboarding_done"));
        return m;
    }

    private CurrentUserDto toCurrentUserDto(Map<String, Object> user) {
        return new CurrentUserDto(
                asString(user.get("user_id")),
                asString(user.get("email")),
                asString(user.get("name")),
                asString(user.get("role")),
                asString(user.get("language")),
                asString(user.get("picture")),
                asString(user.get("bio")),
                asString(user.get("phone")),
                asNullableBoolean(user.get("is_coach_verified")),
                asStringList(user.get("coach_tags")),
                asBoolean(user.get("show_phone")),
                asBoolean(user.get("show_reviews")),
                asString(user.get("created_at")),
                asString(user.get("updated_at")),
                asString(user.get("sports_level")),
                asObjectList(user.get("goals")),
                asObjectList(user.get("user_roles")),
                asNullableBoolean(user.get("onboarding_done"))
        );
    }

    private static String asString(Object v) {
        return v == null ? null : String.valueOf(v);
    }

    private static boolean asBoolean(Object v) {
        return v instanceof Boolean b && b;
    }

    private static Boolean asNullableBoolean(Object v) {
        return v instanceof Boolean b ? b : null;
    }

    @SuppressWarnings("unchecked")
    private static List<String> asStringList(Object v) {
        return v instanceof List<?> l ? (List<String>) l : Collections.emptyList();
    }

    @SuppressWarnings("unchecked")
    private static List<Object> asObjectList(Object v) {
        return v instanceof List<?> l ? (List<Object>) l : Collections.emptyList();
    }

    private static Boolean readNullableBoolean(ResultSet rs, String column) throws SQLException {
        boolean v = rs.getBoolean(column);
        return rs.wasNull() ? null : v;
    }

    private List<String> readStringList(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyList();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<>() {
            });
        } catch (Exception e) {
            return Collections.emptyList();
        }
    }

    private List<Object> readObjectList(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyList();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<>() {
            });
        } catch (Exception e) {
            return Collections.emptyList();
        }
    }

    public record CredentialsRow(String userId, String passwordHash, String role) {
    }
}
