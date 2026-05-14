package com.spotu.modules.users.infra;

import com.spotu.modules.users.dto.FollowerItemDto;
import com.spotu.modules.users.dto.FollowingItemDto;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class FollowListRepository {

    private static final String SELECT_FOLLOWERS = """
            SELECT u.user_id, u.name, u.picture, u.role,
                   CASE WHEN ? IS NOT NULL THEN
                       EXISTS(SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = u.user_id)
                   ELSE FALSE END AS is_following_back,
                   CASE WHEN ? IS NOT NULL THEN
                       EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = u.user_id)
                   ELSE FALSE END AS is_blocked
            FROM user_follows uf
            JOIN users u ON u.user_id = uf.follower_id
            WHERE uf.following_id = ?
            ORDER BY u.name ASC
            """;

    private static final String SELECT_FOLLOWING = """
            SELECT u.user_id, u.name, u.picture, u.role,
                   CASE WHEN ? IS NOT NULL THEN
                       EXISTS(SELECT 1 FROM user_follows WHERE follower_id = u.user_id AND following_id = ?)
                   ELSE FALSE END AS follows_back,
                   CASE WHEN ? IS NOT NULL THEN
                       EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = u.user_id)
                   ELSE FALSE END AS is_blocked
            FROM user_follows uf
            JOIN users u ON u.user_id = uf.following_id
            WHERE uf.follower_id = ?
            ORDER BY u.name ASC
            """;

    private final JdbcTemplate jdbcTemplate;

    public FollowListRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<FollowerItemDto> findFollowers(String userId, String meId) {
        return jdbcTemplate.query(
                SELECT_FOLLOWERS,
                (rs, rowNum) -> new FollowerItemDto(
                        rs.getString("user_id"),
                        rs.getString("name"),
                        rs.getString("picture"),
                        rs.getString("role"),
                        rs.getBoolean("is_following_back"),
                        rs.getBoolean("is_blocked")
                ),
                meId, meId, meId, meId, userId
        );
    }

    public List<FollowingItemDto> findFollowing(String userId, String meId) {
        return jdbcTemplate.query(
                SELECT_FOLLOWING,
                (rs, rowNum) -> new FollowingItemDto(
                        rs.getString("user_id"),
                        rs.getString("name"),
                        rs.getString("picture"),
                        rs.getString("role"),
                        rs.getBoolean("follows_back"),
                        rs.getBoolean("is_blocked")
                ),
                meId, meId, meId, meId, userId
        );
    }
}
