package com.spotu.modules.users.infra;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

@Repository
public class UserProfileRepository {

    private static final String SELECT_RATINGS =
            "SELECT rating FROM reviews WHERE reviewee_id = ?";
    private static final String SELECT_BANKING =
            "SELECT iban, bic, iban_name FROM users WHERE user_id = ?";

    private final JdbcTemplate jdbcTemplate;

    public UserProfileRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<BigDecimal> findRatingsByRevieweeId(String userId) {
        return jdbcTemplate.query(SELECT_RATINGS, (rs, rowNum) -> rs.getBigDecimal("rating"), userId);
    }

    public Optional<BankingDetails> findBankingByUserId(String userId) {
        List<BankingDetails> rows = jdbcTemplate.query(
                SELECT_BANKING,
                (rs, rowNum) -> new BankingDetails(
                        rs.getString("iban"),
                        rs.getString("bic"),
                        rs.getString("iban_name")),
                userId
        );
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(rows.get(0));
    }
}
