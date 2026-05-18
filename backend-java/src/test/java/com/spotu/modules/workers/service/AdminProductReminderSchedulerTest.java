package com.spotu.modules.workers.service;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest
@ActiveProfiles("test")
@Sql(scripts = {"/test-data-users.sql", "/test-data-products-s41.sql"}, executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class AdminProductReminderSchedulerTest {

    @Autowired
    private AdminProductReminderScheduler scheduler;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void reminderWorker_marksReminderAndInsertsAdminNotifications() {
        scheduler.periodicTick();

        Integer reminded = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM marketplace_products WHERE product_id='prod_s41_pending_old' AND admin_reminder_sent_at IS NOT NULL",
                Integer.class
        );
        Integer notifCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notifications WHERE type='admin_product_reminder'",
                Integer.class
        );
        assertEquals(1, reminded);
        assertTrue(notifCount >= 1);

        String sampleData = jdbcTemplate.queryForObject(
                """
                SELECT data FROM notifications
                WHERE type = 'admin_product_reminder'
                ORDER BY created_at DESC
                LIMIT 1
                """,
                String.class
        );
        org.junit.jupiter.api.Assertions.assertNotNull(sampleData);
        org.junit.jupiter.api.Assertions.assertTrue(
                sampleData.contains("prod_s41_pending_old") || sampleData.contains("\"product_id\""),
                "data JSON doit référencer le produit : " + sampleData
        );
    }

    @Test
    void reminderWorker_secondTick_isIdempotentForAlreadyRemindedProducts() {
        scheduler.periodicTick();
        Integer notifAfterFirst = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notifications WHERE type='admin_product_reminder'",
                Integer.class
        );

        scheduler.periodicTick();
        Integer notifAfterSecond = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notifications WHERE type='admin_product_reminder'",
                Integer.class
        );

        assertEquals(notifAfterFirst, notifAfterSecond);
    }
}
