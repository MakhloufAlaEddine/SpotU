package com.spotu.modules.workers.service;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;

import static org.junit.jupiter.api.Assertions.assertEquals;

@SpringBootTest
@ActiveProfiles("test")
@Sql(scripts = {"/test-data-users.sql", "/test-data-products-s40.sql"}, executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class MarketplaceMediaPurgeSchedulerTest {

    @Autowired
    private MarketplaceMediaPurgeScheduler scheduler;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void worker_marksDueDeletedProductsAndKeepsIdempotenceGuards() {
        scheduler.runOneTick("test");

        Boolean duePurged = jdbcTemplate.queryForObject(
                "SELECT media_purged FROM marketplace_products WHERE product_id='prod_s40_deleted_due_worker'",
                Boolean.class
        );
        Boolean reactivatedPurged = jdbcTemplate.queryForObject(
                "SELECT media_purged FROM marketplace_products WHERE product_id='prod_s40_deleted_reactivated'",
                Boolean.class
        );
        assertEquals(Boolean.TRUE, duePurged);
        assertEquals(Boolean.FALSE, reactivatedPurged);

        scheduler.runOneTick("test");
        Integer countPurgedDue = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM marketplace_products WHERE product_id='prod_s40_deleted_due_worker' AND media_purged=TRUE",
                Integer.class
        );
        assertEquals(1, countPurgedDue);
    }
}
