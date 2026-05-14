package com.spotu.modules.spotyou.infra;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class SpotYouMembershipRepository {

    private final JdbcTemplate jdbcTemplate;

    public SpotYouMembershipRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Optional<Boolean> findActiveByPointId(String pointId) {
        List<Boolean> rows = jdbcTemplate.query(
                "SELECT active FROM tag_points WHERE point_id = ?",
                (rs, rn) -> rs.getBoolean("active"),
                pointId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<Map<String, Object>> findTagPointForJoin(String pointId) {
        List<Map<String, Object>> rows = jdbcTemplate.query(
                """
                        SELECT user_id, title, images, visibility_type, join_mode, max_community_members
                        FROM tag_points WHERE point_id = ? AND active = TRUE
                        """,
                (rs, rn) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("user_id", rs.getString("user_id"));
                    m.put("title", rs.getString("title"));
                    m.put("images", rs.getString("images"));
                    m.put("visibility_type", rs.getString("visibility_type"));
                    m.put("join_mode", rs.getString("join_mode"));
                    m.put("max_community_members", rs.getObject("max_community_members"));
                    return m;
                },
                pointId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<Map<String, Object>> findTagPointForInvite(String pointId) {
        List<Map<String, Object>> rows = jdbcTemplate.query(
                """
                        SELECT user_id, title, visibility_type, invite_permissions, images
                        FROM tag_points WHERE point_id = ? AND active = TRUE
                        """,
                (rs, rn) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("user_id", rs.getString("user_id"));
                    m.put("title", rs.getString("title"));
                    m.put("visibility_type", rs.getString("visibility_type"));
                    m.put("invite_permissions", rs.getString("invite_permissions"));
                    m.put("images", rs.getString("images"));
                    return m;
                },
                pointId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<Map<String, Object>> findTagPointForLeave(String pointId) {
        List<Map<String, Object>> rows = jdbcTemplate.query(
                "SELECT user_id, title, images FROM tag_points WHERE point_id = ?",
                (rs, rn) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("user_id", rs.getString("user_id"));
                    m.put("title", rs.getString("title"));
                    m.put("images", rs.getString("images"));
                    return m;
                },
                pointId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<Map<String, Object>> findTagPointForJoinRequests(String pointId) {
        List<Map<String, Object>> rows = jdbcTemplate.query(
                "SELECT user_id, join_mode FROM tag_points WHERE point_id = ? AND active = TRUE",
                (rs, rn) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("user_id", rs.getString("user_id"));
                    m.put("join_mode", rs.getString("join_mode"));
                    return m;
                },
                pointId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<Map<String, Object>> findTagPointForApprove(String pointId) {
        List<Map<String, Object>> rows = jdbcTemplate.query(
                "SELECT user_id, title, images, join_mode FROM tag_points WHERE point_id = ? AND active = TRUE",
                (rs, rn) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("user_id", rs.getString("user_id"));
                    m.put("title", rs.getString("title"));
                    m.put("images", rs.getString("images"));
                    m.put("join_mode", rs.getString("join_mode"));
                    return m;
                },
                pointId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<Map<String, Object>> findTagPointForReject(String pointId) {
        List<Map<String, Object>> rows = jdbcTemplate.query(
                "SELECT user_id, title, images FROM tag_points WHERE point_id = ? AND active = TRUE",
                (rs, rn) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("user_id", rs.getString("user_id"));
                    m.put("title", rs.getString("title"));
                    m.put("images", rs.getString("images"));
                    return m;
                },
                pointId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public int countAcceptedMembers(String pointId) {
        Integer n = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM spot_you_members WHERE spot_you_id = ? AND status = 'accepted'",
                Integer.class,
                pointId
        );
        return n == null ? 0 : n;
    }

    public Optional<String> findMembershipStatus(String pointId, String userId) {
        List<String> rows = jdbcTemplate.query(
                "SELECT status FROM spot_you_members WHERE spot_you_id = ? AND user_id = ?",
                (rs, rn) -> rs.getString("status"),
                pointId, userId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public boolean existsAcceptedMember(String pointId, String userId) {
        Integer n = jdbcTemplate.queryForObject(
                """
                        SELECT COUNT(*) FROM spot_you_members
                        WHERE spot_you_id = ? AND user_id = ? AND status = 'accepted'
                        """,
                Integer.class,
                pointId, userId
        );
        return n != null && n > 0;
    }

    public List<String> findAcceptedMemberUserIdsExcept(String pointId, String excludeUserId) {
        return jdbcTemplate.query(
                "SELECT user_id FROM spot_you_members WHERE spot_you_id = ? AND status = 'accepted' AND user_id <> ?",
                (rs, rn) -> rs.getString("user_id"),
                pointId, excludeUserId
        );
    }

    /**
     * Réactive un membre {@code rejected} vers {@code pending} ou {@code accepted}, ou insère une nouvelle ligne.
     * Reproduit ON CONFLICT DO UPDATE WHERE status='rejected' sans dépendre du dialecte SQL.
     */
    public void upsertMembership(String id, String pointId, String userId, String status, String requestedBy) {
        int updated = jdbcTemplate.update(
                """
                        UPDATE spot_you_members
                        SET status = ?, requested_by = ?
                        WHERE spot_you_id = ? AND user_id = ? AND status = 'rejected'
                        """,
                status, requestedBy, pointId, userId
        );
        if (updated > 0) {
            return;
        }
        try {
            jdbcTemplate.update(
                    """
                            INSERT INTO spot_you_members (id, spot_you_id, user_id, status, requested_by)
                            VALUES (?, ?, ?, ?, ?)
                            """,
                    id, pointId, userId, status, requestedBy
            );
        } catch (DataIntegrityViolationException ignored) {
            // concurrence / doublon : idem ON CONFLICT sans mise à jour
        }
    }

    public int deleteMembershipPending(String pointId, String userId) {
        return jdbcTemplate.update(
                "DELETE FROM spot_you_members WHERE spot_you_id = ? AND user_id = ? AND status = 'pending'",
                pointId, userId
        );
    }

    public int deleteMembershipAny(String pointId, String userId) {
        return jdbcTemplate.update(
                "DELETE FROM spot_you_members WHERE spot_you_id = ? AND user_id = ?",
                pointId, userId
        );
    }

    public void insertInvitation(String id, String pointId, String invitedUserId, String invitedBy) {
        jdbcTemplate.update(
                """
                        INSERT INTO spot_you_members (id, spot_you_id, user_id, status, invited_by, invited_at)
                        VALUES (?, ?, ?, 'invited', ?, CURRENT_TIMESTAMP)
                        """,
                id, pointId, invitedUserId, invitedBy
        );
    }

    public int reinviteAfterRejected(String invitedBy, String pointId, String invitedUserId) {
        return jdbcTemplate.update(
                """
                        UPDATE spot_you_members
                        SET status = 'invited', invited_by = ?, invited_at = CURRENT_TIMESTAMP, requested_by = NULL
                        WHERE spot_you_id = ? AND user_id = ?
                        """,
                invitedBy, pointId, invitedUserId
        );
    }

    public int acceptInvitation(String pointId, String userId) {
        return jdbcTemplate.update(
                """
                        UPDATE spot_you_members SET status = 'accepted', joined_at = CURRENT_TIMESTAMP
                        WHERE spot_you_id = ? AND user_id = ?
                        """,
                pointId, userId
        );
    }

    public int refuseInvitation(String pointId, String userId) {
        return jdbcTemplate.update(
                "UPDATE spot_you_members SET status = 'rejected' WHERE spot_you_id = ? AND user_id = ?",
                pointId, userId
        );
    }

    public Optional<Map<String, Object>> findInvitationRow(String pointId, String userId) {
        List<Map<String, Object>> rows = jdbcTemplate.query(
                "SELECT status, invited_by FROM spot_you_members WHERE spot_you_id = ? AND user_id = ?",
                (rs, rn) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("status", rs.getString("status"));
                    m.put("invited_by", rs.getString("invited_by"));
                    return m;
                },
                pointId, userId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<String> findTagPointTitle(String pointId) {
        List<String> rows = jdbcTemplate.query(
                "SELECT title FROM tag_points WHERE point_id = ?",
                (rs, rn) -> rs.getString("title"),
                pointId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public List<Map<String, Object>> listJoinRequests(String pointId) {
        return jdbcTemplate.query(
                """
                        SELECT m.user_id, m.joined_at, u.name, u.picture, u.role
                        FROM spot_you_members m
                        JOIN users u ON u.user_id = m.user_id
                        WHERE m.spot_you_id = ? AND m.status = 'pending'
                        ORDER BY m.joined_at ASC
                        """,
                (rs, rn) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("user_id", rs.getString("user_id"));
                    m.put("name", rs.getString("name"));
                    m.put("picture", rs.getString("picture"));
                    m.put("role", rs.getString("role"));
                    m.put("joined_at", rs.getTimestamp("joined_at"));
                    return m;
                },
                pointId
        );
    }

    public Optional<Map<String, Object>> findMemberRow(String pointId, String memberId) {
        List<Map<String, Object>> rows = jdbcTemplate.query(
                "SELECT id, status FROM spot_you_members WHERE spot_you_id = ? AND user_id = ?",
                (rs, rn) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getString("id"));
                    m.put("status", rs.getString("status"));
                    return m;
                },
                pointId, memberId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public int approveMember(String approverUserId, String pointId, String memberId) {
        return jdbcTemplate.update(
                """
                        UPDATE spot_you_members
                        SET status = 'accepted', approved_by = ?
                        WHERE spot_you_id = ? AND user_id = ? AND status = 'pending'
                        """,
                approverUserId, pointId, memberId
        );
    }

    public int rejectMember(String approverUserId, String pointId, String memberId) {
        return jdbcTemplate.update(
                """
                        UPDATE spot_you_members
                        SET status = 'rejected', approved_by = ?
                        WHERE spot_you_id = ? AND user_id = ? AND status = 'pending'
                        """,
                approverUserId, pointId, memberId
        );
    }

    public void insertSave(String saveId, String pointId, String userId) {
        try {
            jdbcTemplate.update(
                    "INSERT INTO tag_point_saves (save_id, point_id, user_id) VALUES (?, ?, ?)",
                    saveId, pointId, userId
            );
        } catch (DataIntegrityViolationException ignored) {
            // idempotence save (contrainte unique point_id + user_id)
        }
    }

    public void deleteSave(String pointId, String userId) {
        jdbcTemplate.update("DELETE FROM tag_point_saves WHERE point_id = ? AND user_id = ?", pointId, userId);
    }

    public Optional<String> findUserName(String userId) {
        List<String> rows = jdbcTemplate.query(
                "SELECT name FROM users WHERE user_id = ?",
                (rs, rn) -> rs.getString("name"),
                userId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public Optional<String> findUserRole(String userId) {
        List<String> rows = jdbcTemplate.query(
                "SELECT role FROM users WHERE user_id = ?",
                (rs, rn) -> rs.getString("role"),
                userId
        );
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }
}
