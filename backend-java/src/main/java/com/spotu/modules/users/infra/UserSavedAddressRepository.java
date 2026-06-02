package com.spotu.modules.users.infra;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Map;

@Repository
public class UserSavedAddressRepository {
    private final JdbcTemplate jdbcTemplate;

    public UserSavedAddressRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<Map<String, Object>> list(String userId) {
        return jdbcTemplate.queryForList(
                """
                        SELECT address_id, label, address, lat, lng, icon, position, created_at
                        FROM user_saved_addresses
                        WHERE user_id = ?
                        ORDER BY position ASC, created_at ASC
                        """,
                userId
        );
    }

    public int nextPosition(String userId) {
        Integer max = jdbcTemplate.queryForObject(
                "SELECT COALESCE(MAX(position), -1) FROM user_saved_addresses WHERE user_id = ?",
                Integer.class,
                userId
        );
        return (max == null ? -1 : max) + 1;
    }

    public Map<String, Object> create(
            String addressId,
            String userId,
            String label,
            String address,
            double lat,
            double lng,
            String icon,
            int position
    ) {
        return jdbcTemplate.queryForMap(
                """
                        INSERT INTO user_saved_addresses (address_id, user_id, label, address, lat, lng, icon, position)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        RETURNING address_id, label, address, lat, lng, icon, position, created_at
                        """,
                addressId, userId, label, address, lat, lng, icon, position
        );
    }

    public List<Map<String, Object>> update(
            String addressId,
            String userId,
            String label,
            String address,
            double lat,
            double lng,
            String icon
    ) {
        return jdbcTemplate.queryForList(
                """
                        UPDATE user_saved_addresses
                        SET label = ?, address = ?, lat = ?, lng = ?, icon = ?
                        WHERE address_id = ? AND user_id = ?
                        RETURNING address_id, label, address, lat, lng, icon, position, created_at
                        """,
                label, address, lat, lng, icon, addressId, userId
        );
    }

    public int delete(String addressId, String userId) {
        return jdbcTemplate.update(
                "DELETE FROM user_saved_addresses WHERE address_id = ? AND user_id = ?",
                addressId, userId
        );
    }
}
