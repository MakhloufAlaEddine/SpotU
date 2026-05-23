package com.spotu.modules.users.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.common.JsonbMedia;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.users.infra.ReactivatableRepository;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class ReactivatableService {

    private final AuthMeService authMeService;
    private final ReactivatableRepository repository;
    private final ObjectMapper objectMapper;

    public ReactivatableService(
            AuthMeService authMeService,
            ReactivatableRepository repository,
            ObjectMapper objectMapper
    ) {
        this.authMeService = authMeService;
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> getReactivatable(HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        Instant now = Instant.now();

        List<Map<String, Object>> spotyous = formatRows(
                repository.findDeactivatedTagPoints(user.userId()), "spotyou", now);
        List<Map<String, Object>> services = formatRows(
                repository.findDeactivatedServices(user.userId()), "service", now);
        List<Map<String, Object>> products = formatRows(
                repository.findDeactivatedProducts(user.userId()), "product", now);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("spotyous", spotyous);
        body.put("services", services);
        body.put("products", products);
        body.put("total", spotyous.size() + services.size() + products.size());
        return body;
    }

    private List<Map<String, Object>> formatRows(List<Map<String, Object>> rows, String entityType, Instant now) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            String purgeAtRaw = row.get("media_purge_scheduled_at") == null
                    ? null
                    : String.valueOf(row.get("media_purge_scheduled_at"));
            Integer daysLeft = null;
            if (purgeAtRaw != null && !purgeAtRaw.isBlank()) {
                OffsetDateTime purgeAt = OffsetDateTime.parse(purgeAtRaw);
                daysLeft = (int) Math.max(0, Duration.between(now, purgeAt.toInstant()).toDays());
            }
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", row.get("id"));
            item.put("type", entityType);
            item.put("title", row.get("title"));
            item.put("thumbnail", firstThumbnail(row.get("image_data")));
            item.put("deleted_at", row.get("deleted_at"));
            item.put("media_purge_scheduled_at", purgeAtRaw);
            item.put("days_until_media_purge", daysLeft);
            item.put("media_purged", row.get("media_purged"));
            result.add(item);
        }
        return result;
    }

    private String firstThumbnail(Object imageData) {
        if (imageData == null) {
            return null;
        }
        List<String> urls = JsonbMedia.normalizeImageUrls(objectMapper, imageData, null);
        return urls.isEmpty() ? null : urls.get(0);
    }
}
