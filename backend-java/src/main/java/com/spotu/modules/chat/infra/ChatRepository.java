package com.spotu.modules.chat.infra;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class ChatRepository {
    private final JdbcTemplate jdbcTemplate;

    public ChatRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public boolean canAccessTagpointGroup(String contextId, String userId) {
        Integer found = jdbcTemplate.query(
                """
                SELECT 1 FROM spot_you_members WHERE spot_you_id = ? AND user_id = ?
                UNION
                SELECT 1 FROM tag_points WHERE point_id = ? AND user_id = ?
                """,
                rs -> rs.next() ? 1 : null,
                contextId, userId, contextId, userId
        );
        return found != null;
    }

    public Optional<String> findGroupConversationId(String contextId) {
        List<String> rows = jdbcTemplate.query(
                "SELECT conversation_id FROM conversations WHERE type = 'tagpoint_group' AND context_id = ?",
                (rs, rn) -> rs.getString("conversation_id"),
                contextId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public Optional<String> findPrivateOrServiceConversationId(String type, String contextId, String userId) {
        List<String> rows = jdbcTemplate.query(
                """
                SELECT c.conversation_id
                FROM conversations c
                JOIN conversation_participants cp ON cp.conversation_id = c.conversation_id
                WHERE c.type = ? AND c.context_id = ? AND cp.user_id = ?
                LIMIT 1
                """,
                (rs, rn) -> rs.getString("conversation_id"),
                type, contextId, userId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public Optional<String> findTagPointOwner(String contextId) {
        List<String> rows = jdbcTemplate.query(
                "SELECT user_id FROM tag_points WHERE point_id = ?",
                (rs, rn) -> rs.getString("user_id"),
                contextId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public Optional<String> findTagPointTitle(String contextId) {
        List<String> rows = jdbcTemplate.query(
                "SELECT title FROM tag_points WHERE point_id = ?",
                (rs, rn) -> rs.getString("title"),
                contextId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public Optional<String> findServiceCoach(String contextId) {
        List<String> rows = jdbcTemplate.query(
                "SELECT coach_id FROM services WHERE service_id = ?",
                (rs, rn) -> rs.getString("coach_id"),
                contextId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public Optional<String> findServiceTitle(String contextId) {
        List<String> rows = jdbcTemplate.query(
                "SELECT title FROM services WHERE service_id = ?",
                (rs, rn) -> rs.getString("title"),
                contextId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public void insertConversation(String convId, String type, String contextId, String contextTitle, String createdBy) {
        jdbcTemplate.update(
                "INSERT INTO conversations (conversation_id, type, context_id, context_title, created_by) VALUES (?, ?, ?, ?, ?)",
                convId, type, contextId, contextTitle, createdBy
        );
    }

    public void upsertParticipantActive(String convId, String userId) {
        int updated = jdbcTemplate.update(
                """
                UPDATE conversation_participants
                SET status = 'active', last_read_at = CURRENT_TIMESTAMP
                WHERE conversation_id = ? AND user_id = ?
                """,
                convId, userId
        );
        if (updated > 0) {
            return;
        }
        try {
            jdbcTemplate.update(
                    """
                    INSERT INTO conversation_participants (conversation_id, user_id, status, joined_at, last_read_at)
                    VALUES (?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    """,
                    convId, userId
            );
        } catch (DataIntegrityViolationException ignored) {
            jdbcTemplate.update(
                    """
                    UPDATE conversation_participants
                    SET status = 'active', last_read_at = CURRENT_TIMESTAMP
                    WHERE conversation_id = ? AND user_id = ?
                    """,
                    convId, userId
            );
        }
    }

    /** Insère un participant si absent (PostgreSQL + H2, sans MERGE / ON CONFLICT dialect-specific). */
    public void insertParticipantDefaultStatus(String convId, String userId) {
        if (isParticipantAnyStatus(convId, userId)) {
            return;
        }
        try {
            jdbcTemplate.update(
                    """
                    INSERT INTO conversation_participants (conversation_id, user_id, joined_at, last_read_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    """,
                    convId, userId
            );
        } catch (DataIntegrityViolationException ignored) {
            // concurrence : participant déjà présent
        }
    }

    public Optional<Map<String, Object>> getConversationMeta(String convId) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                """
                SELECT conversation_id, type, context_id, context_title, created_by, last_message_at, created_at
                FROM conversations WHERE conversation_id = ?
                """,
                convId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public List<Map<String, Object>> listConversationsBase(String userId) {
        return jdbcTemplate.queryForList(
                """
                SELECT c.conversation_id, c.type, c.context_id,
                       COALESCE(
                           CASE WHEN c.type IN ('tagpoint_private','tagpoint_group') THEN tp.title ELSE NULL END,
                           CASE WHEN c.type = 'service' THEN svc.title ELSE NULL END,
                           c.context_title
                       ) AS context_title,
                       c.created_by, c.last_message_at, c.created_at,
                       CASE
                           WHEN c.context_deleted = TRUE THEN TRUE
                           WHEN c.type IN ('tagpoint_private','tagpoint_group')
                                AND (tp.point_id IS NULL OR tp.active = FALSE OR tp.deleted_at IS NOT NULL)
                                THEN TRUE
                           WHEN c.type = 'service'
                                AND (svc.service_id IS NULL OR svc.active = FALSE OR svc.deleted_at IS NOT NULL)
                                THEN TRUE
                           ELSE FALSE
                       END AS context_deleted
                FROM conversations c
                LEFT JOIN tag_points tp ON c.type IN ('tagpoint_private','tagpoint_group') AND tp.point_id = c.context_id
                LEFT JOIN services svc ON c.type = 'service' AND svc.service_id = c.context_id
                JOIN conversation_participants cp ON cp.conversation_id = c.conversation_id
                WHERE cp.user_id = ? AND c.deleted_at IS NULL
                ORDER BY c.last_message_at DESC NULLS LAST
                """,
                userId
        );
    }

    public List<Map<String, Object>> lastMessages(List<String> convIds) {
        if (convIds.isEmpty()) return List.of();
        String in = String.join(",", convIds.stream().map(x -> "?").toList());
        return jdbcTemplate.queryForList(
                "SELECT m.conversation_id, m.message_id, " +
                        "CASE WHEN m.deleted_at IS NOT NULL THEN '[Message supprimé]' ELSE m.content END AS content, " +
                        "m.created_at, m.sender_id, COALESCE(u.name, 'Utilisateur supprimé') AS sender_name " +
                        "FROM messages m LEFT JOIN users u ON u.user_id = m.sender_id " +
                        "WHERE m.conversation_id IN (" + in + ") " +
                        "AND m.created_at = (SELECT MAX(m2.created_at) FROM messages m2 WHERE m2.conversation_id = m.conversation_id)",
                convIds.toArray()
        );
    }

    public List<Map<String, Object>> unreadCounts(String userId, List<String> convIds) {
        if (convIds.isEmpty()) return List.of();
        String in = String.join(",", convIds.stream().map(x -> "?").toList());
        return jdbcTemplate.queryForList(
                "SELECT m.conversation_id, " +
                        "SUM(CASE WHEN m.created_at > cp.last_read_at AND m.sender_id <> ? THEN 1 ELSE 0 END) AS unread_count " +
                        "FROM messages m " +
                        "JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = ? " +
                        "WHERE m.conversation_id IN (" + in + ") " +
                        "GROUP BY m.conversation_id",
                // keep parity with FILTER sender != caller and cp user
                buildUnreadArgs(userId, convIds)
        );
    }

    private Object[] buildUnreadArgs(String userId, List<String> convIds) {
        Object[] args = new Object[convIds.size() + 2];
        args[0] = userId;
        args[1] = userId;
        for (int i = 0; i < convIds.size(); i++) args[i + 2] = convIds.get(i);
        return args;
    }

    public List<Map<String, Object>> participantStatuses(String userId, List<String> convIds) {
        if (convIds.isEmpty()) return List.of();
        String in = String.join(",", convIds.stream().map(x -> "?").toList());
        Object[] args = new Object[convIds.size() + 1];
        for (int i = 0; i < convIds.size(); i++) args[i] = convIds.get(i);
        args[convIds.size()] = userId;
        return jdbcTemplate.queryForList(
                "SELECT conversation_id, status FROM conversation_participants WHERE conversation_id IN (" + in + ") AND user_id = ?",
                args
        );
    }

    public List<Map<String, Object>> otherParticipants(String userId, List<String> convIds) {
        if (convIds.isEmpty()) return List.of();
        String in = String.join(",", convIds.stream().map(x -> "?").toList());
        Object[] args = new Object[convIds.size() + 1];
        for (int i = 0; i < convIds.size(); i++) args[i] = convIds.get(i);
        args[convIds.size()] = userId;
        return jdbcTemplate.queryForList(
                "SELECT cp.conversation_id, u.user_id, u.name, u.picture " +
                        "FROM conversation_participants cp " +
                        "JOIN users u ON u.user_id = cp.user_id " +
                        "WHERE cp.conversation_id IN (" + in + ") " +
                        "AND cp.user_id <> ?",
                args
        );
    }

    public List<Map<String, Object>> participantCounts(List<String> convIds) {
        if (convIds.isEmpty()) return List.of();
        String in = String.join(",", convIds.stream().map(x -> "?").toList());
        return jdbcTemplate.queryForList(
                "SELECT conversation_id, COUNT(*) AS cnt FROM conversation_participants WHERE conversation_id IN (" + in + ") GROUP BY conversation_id",
                convIds.toArray()
        );
    }

    public List<Map<String, Object>> groupImages(List<String> contextIds) {
        if (contextIds.isEmpty()) return List.of();
        String in = String.join(",", contextIds.stream().map(x -> "?").toList());
        return jdbcTemplate.queryForList(
                "SELECT point_id, images FROM tag_points WHERE point_id IN (" + in + ")",
                contextIds.toArray()
        );
    }

    public boolean isParticipantAnyStatus(String convId, String userId) {
        Integer v = jdbcTemplate.query(
                "SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?",
                rs -> rs.next() ? 1 : null,
                convId, userId
        );
        return v != null;
    }

    public boolean isParticipantActive(String convId, String userId) {
        Integer v = jdbcTemplate.query(
                "SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ? AND status = 'active'",
                rs -> rs.next() ? 1 : null,
                convId, userId
        );
        return v != null;
    }

    public List<Map<String, Object>> getMessages(String convId, int limit, OffsetDateTime before) {
        if (before == null) {
            return jdbcTemplate.queryForList(
                    """
                    SELECT m.message_id, m.conversation_id, m.sender_id,
                           CASE WHEN m.deleted_at IS NOT NULL THEN '[Message supprimé]' ELSE m.content END AS content,
                           m.created_at, m.deleted_at,
                           COALESCE(u.name, 'Utilisateur supprimé') AS sender_name,
                           u.picture AS sender_picture
                    FROM messages m
                    LEFT JOIN users u ON m.sender_id = u.user_id
                    WHERE m.conversation_id = ?
                    ORDER BY m.created_at DESC
                    LIMIT ?
                    """,
                    convId, limit
            );
        }
        return jdbcTemplate.queryForList(
                """
                SELECT m.message_id, m.conversation_id, m.sender_id,
                       CASE WHEN m.deleted_at IS NOT NULL THEN '[Message supprimé]' ELSE m.content END AS content,
                       m.created_at, m.deleted_at,
                       COALESCE(u.name, 'Utilisateur supprimé') AS sender_name,
                       u.picture AS sender_picture
                FROM messages m
                LEFT JOIN users u ON m.sender_id = u.user_id
                WHERE m.conversation_id = ? AND m.created_at < ?
                ORDER BY m.created_at DESC
                LIMIT ?
                """,
                convId, Timestamp.from(before.toInstant()), limit
        );
    }

    public void markRead(String convId, String userId) {
        jdbcTemplate.update(
                "UPDATE conversation_participants SET last_read_at = CURRENT_TIMESTAMP WHERE conversation_id = ? AND user_id = ?",
                convId, userId
        );
    }

    public int unreadTotal(String userId) {
        Integer n = jdbcTemplate.queryForObject(
                """
                SELECT COALESCE(SUM(CASE WHEN m.created_at > cp.last_read_at AND m.sender_id <> ? THEN 1 ELSE 0 END), 0) FROM messages m
                JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = ?
                """,
                Integer.class,
                userId, userId
        );
        return n == null ? 0 : n;
    }

    public int unreadNotif(String userId) {
        Integer n = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read = FALSE",
                Integer.class,
                userId
        );
        return n == null ? 0 : n;
    }

    public void insertMessage(String messageId, String convId, String senderId, String content, OffsetDateTime at) {
        jdbcTemplate.update(
                "INSERT INTO messages (message_id, conversation_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?)",
                messageId, convId, senderId, content, Timestamp.from(at.toInstant())
        );
    }

    public void updateConversationLastMessageAt(String convId, OffsetDateTime at) {
        jdbcTemplate.update(
                "UPDATE conversations SET last_message_at = ? WHERE conversation_id = ?",
                Timestamp.from(at.toInstant()), convId
        );
    }

    public List<String> otherActiveParticipants(String convId, String senderId) {
        return jdbcTemplate.query(
                "SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id <> ? AND status = 'active'",
                (rs, rn) -> rs.getString("user_id"),
                convId, senderId
        );
    }

    public Optional<Map<String, Object>> findUserSummary(String userId) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT user_id, name, picture FROM users WHERE user_id = ?",
                userId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public boolean isContextDeleted(String convId) {
        Boolean b = jdbcTemplate.query(
                "SELECT context_deleted FROM conversations WHERE conversation_id = ?",
                rs -> rs.next() ? rs.getBoolean("context_deleted") : null,
                convId
        );
        return Boolean.TRUE.equals(b);
    }

    public Optional<Map<String, Object>> findMessageById(String messageId) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT message_id, sender_id, conversation_id, deleted_at FROM messages WHERE message_id = ?",
                messageId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public void softDeleteMessage(String messageId) {
        jdbcTemplate.update("UPDATE messages SET deleted_at = CURRENT_TIMESTAMP WHERE message_id = ?", messageId);
    }

    public Optional<String> findParticipantStatus(String convId, String userId) {
        List<String> rows = jdbcTemplate.query(
                "SELECT status FROM conversation_participants WHERE conversation_id = ? AND user_id = ?",
                (rs, rn) -> rs.getString("status"),
                convId, userId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public void markLeft(String convId, String userId) {
        jdbcTemplate.update(
                "UPDATE conversation_participants SET status = 'left' WHERE conversation_id = ? AND user_id = ?",
                convId, userId
        );
    }

    public int activeParticipants(String convId) {
        Integer n = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = ? AND status = 'active'",
                Integer.class,
                convId
        );
        return n == null ? 0 : n;
    }

    public void softDeleteConversationIfNeeded(String convId) {
        jdbcTemplate.update(
                "UPDATE conversations SET deleted_at = CURRENT_TIMESTAMP WHERE conversation_id = ? AND deleted_at IS NULL",
                convId
        );
    }
}
