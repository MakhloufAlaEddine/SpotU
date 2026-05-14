package com.spotu.modules.workers.service;

import com.spotu.modules.uploads.service.FileStorageService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;

@SpringBootTest
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class MarketplaceFilePurgeServiceIntegrationTest {

    @Autowired
    private MarketplaceFilePurgeService service;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @MockBean
    private FileStorageService fileStorageService;

    @Test
    void runPurge_marksDoneForDuePendingProductRows_only() {
        jdbcTemplate.update("DELETE FROM pending_file_deletions WHERE entity_id LIKE 'prod_purge_%'");
        jdbcTemplate.update(
                """
                INSERT INTO pending_file_deletions(file_url, entity_type, entity_id, scheduled_at, status)
                VALUES
                ('https://img/purge/due.jpg', 'product', 'prod_purge_due', DATEADD('DAY', -1, CURRENT_TIMESTAMP), 'pending'),
                ('https://img/purge/future.jpg', 'product', 'prod_purge_future', DATEADD('DAY', 1, CURRENT_TIMESTAMP), 'pending'),
                ('https://img/purge/other.jpg', 'spotyou', 'prod_purge_other', DATEADD('DAY', -1, CURRENT_TIMESTAMP), 'pending'),
                ('https://img/purge/processing.jpg', 'product', 'prod_purge_processing', DATEADD('DAY', -1, CURRENT_TIMESTAMP), 'processing')
                """
        );

        service.runPurge(0);

        String dueStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM pending_file_deletions WHERE entity_id='prod_purge_due'",
                String.class
        );
        String futureStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM pending_file_deletions WHERE entity_id='prod_purge_future'",
                String.class
        );
        String otherTypeStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM pending_file_deletions WHERE entity_id='prod_purge_other'",
                String.class
        );
        String processingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM pending_file_deletions WHERE entity_id='prod_purge_processing'",
                String.class
        );
        assertEquals("done", dueStatus);
        assertEquals("pending", futureStatus);
        assertEquals("pending", otherTypeStatus);
        assertEquals("processing", processingStatus);
        verify(fileStorageService).deleteUploadFile("https://img/purge/due.jpg");
    }

    @Test
    void runPurge_whenDeleteFails_marksFailed_andContinues() {
        jdbcTemplate.update("DELETE FROM pending_file_deletions WHERE entity_id LIKE 'prod_purge_%'");
        jdbcTemplate.update(
                """
                INSERT INTO pending_file_deletions(file_url, entity_type, entity_id, scheduled_at, status)
                VALUES
                ('https://img/purge/fail.jpg', 'product', 'prod_purge_fail', DATEADD('DAY', -1, CURRENT_TIMESTAMP), 'pending'),
                ('https://img/purge/ok.jpg', 'product', 'prod_purge_ok', DATEADD('DAY', -1, CURRENT_TIMESTAMP), 'pending')
                """
        );
        doThrow(new RuntimeException("boom"))
                .when(fileStorageService).deleteUploadFile("https://img/purge/fail.jpg");

        service.runPurge(0);

        String failStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM pending_file_deletions WHERE entity_id='prod_purge_fail'",
                String.class
        );
        String okStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM pending_file_deletions WHERE entity_id='prod_purge_ok'",
                String.class
        );
        assertEquals("failed", failStatus);
        assertEquals("done", okStatus);
        verify(fileStorageService).deleteUploadFile("https://img/purge/fail.jpg");
        verify(fileStorageService).deleteUploadFile("https://img/purge/ok.jpg");
    }

    @Test
    void runPurge_concurrentCalls_keepSingleFinalState_withoutPendingLeft() throws Exception {
        jdbcTemplate.update("DELETE FROM pending_file_deletions WHERE entity_id LIKE 'prod_purge_conc_%'");
        jdbcTemplate.update(
                """
                INSERT INTO pending_file_deletions(file_url, entity_type, entity_id, scheduled_at, status)
                VALUES ('https://img/purge/conc.jpg', 'product', 'prod_purge_conc_1', DATEADD('DAY', -1, CURRENT_TIMESTAMP), 'pending')
                """
        );

        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            CompletableFuture<Void> f1 = CompletableFuture.runAsync(() -> service.runPurge(0), executor);
            CompletableFuture<Void> f2 = CompletableFuture.runAsync(() -> service.runPurge(0), executor);
            f1.get();
            f2.get();
        } finally {
            executor.shutdownNow();
        }

        Integer doneCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM pending_file_deletions WHERE entity_id='prod_purge_conc_1' AND status='done'",
                Integer.class
        );
        Integer pendingCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM pending_file_deletions WHERE entity_id='prod_purge_conc_1' AND status='pending'",
                Integer.class
        );
        Integer failedCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM pending_file_deletions WHERE entity_id='prod_purge_conc_1' AND status='failed'",
                Integer.class
        );
        assertEquals(1, doneCount);
        assertEquals(0, pendingCount);
        assertEquals(0, failedCount);
        verify(fileStorageService, org.mockito.Mockito.atLeastOnce()).deleteUploadFile("https://img/purge/conc.jpg");
        assertTrue(doneCount + pendingCount + failedCount == 1);
    }
}
