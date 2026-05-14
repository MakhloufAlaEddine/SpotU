package com.spotu.infra.api;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.sql.DataSource;
import java.sql.Connection;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Parité avec les routes infra Python sous {@code /api} : liveness et readiness ({@code server.py}).
 */
@RestController
@RequestMapping("/api")
public class InfraApiController {

    private final DataSource dataSource;

    public InfraApiController(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @GetMapping("/liveness")
    public Map<String, Object> liveness() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", "alive");
        body.put("timestamp", Instant.now().toString());
        return body;
    }

    @GetMapping("/readiness")
    public ResponseEntity<Map<String, Object>> readiness() {
        Instant now = Instant.now();
        try (Connection conn = dataSource.getConnection()) {
            if (!conn.isValid(5)) {
                return notReady(now, "validation_failed", "Connection validation failed");
            }
            try (var st = conn.prepareStatement("SELECT 1")) {
                st.executeQuery().close();
            }
        } catch (Exception ex) {
            return notReady(now, "error", ex.getMessage());
        }
        Map<String, Object> ok = new LinkedHashMap<>();
        ok.put("status", "ready");
        ok.put("database", "ok");
        ok.put("timestamp", now.toString());
        return ResponseEntity.ok(ok);
    }

    private static ResponseEntity<Map<String, Object>> notReady(Instant now, String dbKey, String dbDetail) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", "not_ready");
        body.put("database", dbDetail == null ? dbKey : dbDetail);
        body.put("timestamp", now.toString());
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(body);
    }
}
