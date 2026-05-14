package com.spotu.modules.workers.service;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.jdbc.Sql;

import static org.junit.jupiter.api.Assertions.assertEquals;

@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = {
        "admin.product.reminder.enabled=false",
        "admin.product.reminder.interval.secs=600"
})
@Sql(scripts = {"/test-data-users.sql", "/test-data-products-s41.sql"}, executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class AdminProductReminderSchedulerDisabledTest {

    @Autowired
    private AdminProductReminderScheduler scheduler;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void periodicTick_disabled_doesNothing() {
        scheduler.periodicTick();

        Integer reminded = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM marketplace_products WHERE admin_reminder_sent_at IS NOT NULL",
                Integer.class
        );
        Integer notifCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notifications WHERE type='admin_product_reminder'",
                Integer.class
        );
        assertEquals(0, reminded);
        assertEquals(0, notifCount);
    }
}
