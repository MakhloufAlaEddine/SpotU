package com.spotu.modules.users.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class UserProfileWriteRepository {

    private final JdbcTemplate jdbcTemplate;

    public UserProfileWriteRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public void updateProfileDynamic(String userId, Map<String, Object> updateFields) {
        StringBuilder sql = new StringBuilder("UPDATE users SET ");
        List<Object> params = new ArrayList<>();
        boolean first = true;
        for (Map.Entry<String, Object> e : updateFields.entrySet()) {
            if (!first) {
                sql.append(", ");
            }
            first = false;
            sql.append(e.getKey()).append(" = ?");
            params.add(e.getValue());
        }
        sql.append(", updated_at = CURRENT_TIMESTAMP WHERE user_id = ?");
        params.add(userId);
        jdbcTemplate.update(sql.toString(), params.toArray());
    }

    public void becomeCoach(String userId) {
        jdbcTemplate.update(
                "UPDATE users SET role = 'coach', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
                userId
        );
    }

    public Optional<String> findCoverPicture(String userId) {
        List<String> rows = jdbcTemplate.query(
                "SELECT cover_picture FROM users WHERE user_id = ?",
                (rs, rn) -> rs.getString("cover_picture"),
                userId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public void updateCoverWithTransform(String userId, String coverPicture, double coverOffsetY, double coverScale) {
        jdbcTemplate.update(
                """
                        UPDATE users
                        SET cover_picture = ?, cover_offset_y = ?, cover_scale = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE user_id = ?
                        """,
                coverPicture, coverOffsetY, coverScale, userId
        );
    }

    public void updateCoverOnly(String userId, String coverPicture) {
        jdbcTemplate.update(
                "UPDATE users SET cover_picture = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
                coverPicture, userId
        );
    }
}

