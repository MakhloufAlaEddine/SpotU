package com.spotu.modules.payments.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.error.ApiForbiddenException;
import com.spotu.error.ApiNotFoundException;
import com.spotu.modules.auth.support.PythonIsoTimestamps;
import com.spotu.modules.payments.infra.PaymentReadRepository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

@Service
public class PaymentReadService {

    private final PaymentReadRepository repository;
    private final ObjectMapper objectMapper;

    public PaymentReadService(PaymentReadRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    public List<Map<String, Object>> getMyPayments(String userId) {
        List<Map<String, Object>> rows = repository.findByUserWithNames(userId);
        List<Map<String, Object>> out = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            out.add(deserializeSnapshot(normalizeRow(row)));
        }
        return out;
    }

    public Map<String, Object> getPaymentById(String paymentId, String userId, String role) {
        Optional<Map<String, Object>> row = repository.findByPaymentId(paymentId);
        if (row.isEmpty()) {
            throw new ApiNotFoundException("Payment not found");
        }
        Map<String, Object> data = deserializeSnapshot(normalizeRow(row.get()));

        String payerUserId = asString(data.get("payer_user_id"));
        String receiverUserId = asString(data.get("receiver_user_id"));
        boolean isPayer = userId != null && userId.equals(payerUserId);
        boolean isReceiver = userId != null && userId.equals(receiverUserId);
        boolean isAdmin = "admin".equals(role);
        if (!isPayer && !isReceiver && !isAdmin) {
            throw new ApiForbiddenException("Access denied");
        }

        return data;
    }

    private Map<String, Object> normalizeRow(Map<String, Object> row) {
        LinkedHashMap<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : row.entrySet()) {
            String key = e.getKey() == null ? null : e.getKey().toLowerCase(Locale.ROOT);
            out.put(key, normalizeValue(e.getValue()));
        }
        return out;
    }

    private Object normalizeValue(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof BigDecimal bd) {
            return bd.doubleValue();
        }
        if (value instanceof Timestamp ts) {
            return PythonIsoTimestamps.fromTimestamp(ts);
        }
        if (value instanceof OffsetDateTime odt) {
            return odt.truncatedTo(ChronoUnit.MICROS).atZoneSameInstant(ZoneOffset.UTC)
                    .toOffsetDateTime().format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSSSSxxx"));
        }
        if (value instanceof Instant instant) {
            return PythonIsoTimestamps.fromTimestamp(Timestamp.from(instant));
        }
        return value;
    }

    private Map<String, Object> deserializeSnapshot(Map<String, Object> row) {
        Object snap = row.get("pricing_rule_snapshot");
        if (snap instanceof String s && !s.isBlank()) {
            try {
                row.put("pricing_rule_snapshot", objectMapper.readValue(s, Object.class));
            } catch (Exception ignored) {
                // Python laisse la valeur telle quelle si le parse n'est pas applicable.
            }
        }
        return row;
    }

    private static String asString(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
