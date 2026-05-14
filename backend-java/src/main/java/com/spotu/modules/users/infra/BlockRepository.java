package com.spotu.modules.users.infra;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class BlockRepository {

    private static final String INSERT_BLOCK_IDEMPOTENT = """
            INSERT INTO user_blocks (blocker_id, blocked_id)
            SELECT ?, ?
            WHERE NOT EXISTS (
                SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?
            )
            """;
    private static final String DELETE_BLOCK =
            "DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?";

    private final JdbcTemplate jdbcTemplate;

    public BlockRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public void blockIdempotent(String blockerId, String blockedId) {
        jdbcTemplate.update(INSERT_BLOCK_IDEMPOTENT, blockerId, blockedId, blockerId, blockedId);
    }

    public void unblock(String blockerId, String blockedId) {
        jdbcTemplate.update(DELETE_BLOCK, blockerId, blockedId);
    }
}
