package com.spotu.modules.workers.service;

import com.spotu.modules.uploads.service.FileStorageService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

@Service
public class MarketplaceFilePurgeService {

    private static final Logger log = LoggerFactory.getLogger(MarketplaceFilePurgeService.class);
    private final JdbcTemplate jdbcTemplate;
    private final FileStorageService fileStorageService;

    public MarketplaceFilePurgeService(JdbcTemplate jdbcTemplate, FileStorageService fileStorageService) {
        this.jdbcTemplate = jdbcTemplate;
        this.fileStorageService = fileStorageService;
    }

    public void runPurge(int retentionDays) {
        int days = Math.max(retentionDays, 0);
        Timestamp cutoff = Timestamp.from(Instant.now().minus(days, ChronoUnit.DAYS));
        List<PendingDeletionRow> due = jdbcTemplate.query(
                """
                        SELECT id, file_url
                        FROM pending_file_deletions
                        WHERE status = 'pending'
                          AND entity_type = 'product'
                          AND scheduled_at <= ?
                        ORDER BY id ASC
                        LIMIT 500
                        """,
                (rs, rn) -> new PendingDeletionRow(
                        rs.getLong("id"),
                        rs.getString("file_url")
                ),
                cutoff
        );
        int attempted = 0;
        int done = 0;
        int failed = 0;
        for (PendingDeletionRow row : due) {
            attempted++;
            try {
                fileStorageService.deleteUploadFile(row.fileUrl());
                done += jdbcTemplate.update(
                        "UPDATE pending_file_deletions SET status = 'done' WHERE id = ? AND status = 'pending'",
                        row.id()
                );
            } catch (Exception ex) {
                failed += jdbcTemplate.update(
                        "UPDATE pending_file_deletions SET status = 'failed' WHERE id = ? AND status = 'pending'",
                        row.id()
                );
                log.warn("[PURGE-PHYSICAL] delete failed id={} url={}: {}", row.id(), row.fileUrl(), ex.getMessage());
            }
        }
        log.info("[PURGE-PHYSICAL] run_purge(retention_days={}) attempted={} done={} failed={}",
                days, attempted, done, failed);
    }

    private record PendingDeletionRow(long id, String fileUrl) {
    }
}
