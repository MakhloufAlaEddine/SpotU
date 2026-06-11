package com.spotu.modules.push.infra;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;

@Repository
public class PushTokenRepository {

    private final JdbcTemplate jdbcTemplate;

    public PushTokenRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Optional<PushTokenRow> findByToken(String token) {
        List<PushTokenRow> rows = jdbcTemplate.query(
                "SELECT token_id, user_id, token, platform, is_active, created_at, last_used_at FROM push_tokens WHERE token = ?",
                (rs, rn) -> new PushTokenRow(
                        rs.getString("token_id"),
                        rs.getString("user_id"),
                        rs.getString("token"),
                        rs.getString("platform"),
                        rs.getBoolean("is_active"),
                        rs.getTimestamp("created_at"),
                        rs.getTimestamp("last_used_at")
                ),
                token
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public void reactivateByToken(String token) {
        jdbcTemplate.update(
                "UPDATE push_tokens SET is_active = TRUE, last_used_at = CURRENT_TIMESTAMP WHERE token = ?",
                token
        );
    }

    public void deactivateByToken(String token) {
        jdbcTemplate.update("UPDATE push_tokens SET is_active = FALSE WHERE token = ?", token);
    }

    public void deactivateByTokenAndUser(String token, String userId) {
        jdbcTemplate.update(
                "UPDATE push_tokens SET is_active = FALSE WHERE token = ? AND user_id = ?",
                token, userId
        );
    }

    public void insert(String tokenId, String userId, String token, String platform) {
        jdbcTemplate.update(
                """
                        INSERT INTO push_tokens (token_id, user_id, token, platform, is_active, created_at, last_used_at)
                        VALUES (?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        """,
                tokenId, userId, token, platform
        );
    }

    public void transferOrInsert(String tokenId, String userId, String token, String platform) {
        Optional<PushTokenRow> existing = findByToken(token);
        if (existing.isPresent()) {
            jdbcTemplate.update(
                    "UPDATE push_tokens SET user_id = ?, platform = ?, is_active = TRUE, last_used_at = CURRENT_TIMESTAMP WHERE token = ?",
                    userId, platform, token
            );
        } else {
            insert(tokenId, userId, token, platform);
        }
    }

    public List<String> findActiveExpoTokensByUserId(String userId) {
        return jdbcTemplate.query(
                """
                        SELECT token
                        FROM push_tokens
                        WHERE user_id = ? AND is_active = TRUE
                        ORDER BY last_used_at DESC
                        """,
                (rs, rn) -> rs.getString("token"),
                userId
        );
    }

    public record PushTokenRow(
            String tokenId,
            String userId,
            String token,
            String platform,
            boolean isActive,
            Timestamp createdAt,
            Timestamp lastUsedAt
    ) {
    }
}

