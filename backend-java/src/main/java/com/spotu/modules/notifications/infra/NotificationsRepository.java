package com.spotu.modules.notifications.infra;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class NotificationsRepository {

    private final JdbcTemplate jdbcTemplate;

    public NotificationsRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<Map<String, Object>> listByUserId(String userId, int limit) {
        return jdbcTemplate.queryForList(
                """
                SELECT n.notif_id, n.type, n.title, n.body, n.data, n.read, n.created_at
                FROM notifications n
                WHERE n.user_id = ?
                ORDER BY n.created_at DESC
                LIMIT ?
                """,
                userId, limit
        );
    }

    public int markRead(String notifId, String userId) {
        return jdbcTemplate.update(
                "UPDATE notifications SET read = TRUE WHERE notif_id = ? AND user_id = ?",
                notifId, userId
        );
    }

    public int markAllRead(String userId) {
        return jdbcTemplate.update(
                "UPDATE notifications SET read = TRUE WHERE user_id = ? AND read = FALSE",
                userId
        );
    }

    public int countUnread(String userId) {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read = FALSE",
                Integer.class,
                userId
        );
        return count == null ? 0 : count;
    }

    public Optional<String> findCurrentPictureByUserId(String userId) {
        List<String> rows = jdbcTemplate.query(
                "SELECT picture FROM users WHERE user_id = ?",
                (rs, rowNum) -> rs.getString("picture"),
                userId
        );
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        return Optional.ofNullable(rows.get(0));
    }
}
