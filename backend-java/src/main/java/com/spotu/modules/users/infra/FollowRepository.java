package com.spotu.modules.users.infra;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class FollowRepository {

    private static final String INSERT_IDEMPOTENT = """
            INSERT INTO user_follows (follower_id, following_id)
            SELECT ?, ?
            WHERE NOT EXISTS (
                SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = ?
            )
            """;
    private static final String DELETE_RELATION =
            "DELETE FROM user_follows WHERE follower_id = ? AND following_id = ?";
    private static final String DELETE_BIDIRECTIONAL = """
            DELETE FROM user_follows
            WHERE (follower_id = ? AND following_id = ?)
               OR (follower_id = ? AND following_id = ?)
            """;
    private static final String COUNT_FOLLOWERS =
            "SELECT COUNT(*) FROM user_follows WHERE following_id = ?";
    private static final String EXISTS_TARGET_USER =
            "SELECT EXISTS(SELECT 1 FROM users WHERE user_id = ?)";

    private final JdbcTemplate jdbcTemplate;

    public FollowRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public void followIdempotent(String followerId, String followingId) {
        jdbcTemplate.update(INSERT_IDEMPOTENT, followerId, followingId, followerId, followingId);
    }

    public void unfollow(String followerId, String followingId) {
        jdbcTemplate.update(DELETE_RELATION, followerId, followingId);
    }

    public void deleteBidirectional(String userId1, String userId2) {
        jdbcTemplate.update(DELETE_BIDIRECTIONAL, userId1, userId2, userId2, userId1);
    }

    public int countFollowers(String targetUserId) {
        Integer count = jdbcTemplate.queryForObject(COUNT_FOLLOWERS, Integer.class, targetUserId);
        return count == null ? 0 : count;
    }

    public boolean targetExists(String targetUserId) {
        Boolean exists = jdbcTemplate.queryForObject(EXISTS_TARGET_USER, Boolean.class, targetUserId);
        return Boolean.TRUE.equals(exists);
    }
}
