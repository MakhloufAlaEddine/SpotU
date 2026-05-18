package com.spotu.modules.marketplace.infra;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest
@ActiveProfiles("test")
@Sql(scripts = {"/test-data-users.sql"}, executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class AdminProductRepositoryNotificationTest {

    @Autowired
    private AdminProductRepository repository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void insertNotification_persistsJsonPayloadInDataColumn() {
        jdbcTemplate.update("DELETE FROM notifications WHERE type = 'test_jsonb_insert'");

        repository.insertNotification(
                "user_admin001",
                "test_jsonb_insert",
                "Titre test",
                "Corps test",
                Map.of("productId", "prod_test_jsonb", "source", "integration_test")
        );

        String data = jdbcTemplate.queryForObject(
                "SELECT data FROM notifications WHERE type = 'test_jsonb_insert' LIMIT 1",
                String.class
        );
        assertNotNull(data);
        assertTrue(data.contains("prod_test_jsonb"), "data doit contenir le JSON sérialisé : " + data);
        assertTrue(data.contains("integration_test"));
    }
}
