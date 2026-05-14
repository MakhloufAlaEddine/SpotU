package com.spotu.modules.users.infra;

import com.spotu.modules.auth.support.PythonIsoTimestamps;
import com.spotu.modules.users.dto.UserReviewItemDto;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class UserReviewsRepository {

    private static final String SELECT_SHOW_REVIEWS =
            "SELECT show_reviews FROM users WHERE user_id = ?";

    private static final String SELECT_REVIEWS = """
            SELECT r.review_id, r.rating, r.comment, r.created_at,
                   u.user_id AS reviewer_id, u.name AS reviewer_name, u.picture AS reviewer_picture
            FROM reviews r
            JOIN users u ON u.user_id = r.reviewer_id
            WHERE r.reviewee_id = ?
            ORDER BY r.created_at DESC
            """;

    private final JdbcTemplate jdbcTemplate;

    public UserReviewsRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Boolean findShowReviews(String userId) {
        List<Boolean> rows = jdbcTemplate.query(SELECT_SHOW_REVIEWS, (rs, rowNum) -> rs.getBoolean("show_reviews"), userId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public List<UserReviewItemDto> findReviewsByUserId(String userId) {
        return jdbcTemplate.query(SELECT_REVIEWS, (rs, rowNum) -> new UserReviewItemDto(
                rs.getString("review_id"),
                rs.getInt("rating"),
                rs.getString("comment"),
                PythonIsoTimestamps.fromTimestamp(rs.getTimestamp("created_at")),
                rs.getString("reviewer_id"),
                rs.getString("reviewer_name"),
                rs.getString("reviewer_picture")
        ), userId);
    }
}
