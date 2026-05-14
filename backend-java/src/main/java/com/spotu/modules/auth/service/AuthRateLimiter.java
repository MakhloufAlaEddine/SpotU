package com.spotu.modules.auth.service;

import com.spotu.error.ApiTooManyRequestsException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Rate limiter en mémoire pour les endpoints auth (équivalent SlowAPI sur ce scope).
 */
@Service
public class AuthRateLimiter {

    private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();

    @Value("${app.auth-rate-limit.testing-bypass:false}")
    private boolean testingBypass;

    public void check(HttpServletRequest request, String routeKey, int maxRequests, int windowSeconds) {
        if (testingBypass && request.getHeader("X-Test-Rate-Limit") == null) {
            return;
        }
        String key = routeKey + ":" + clientKey(request);
        long now = Instant.now().getEpochSecond();
        Bucket bucket = buckets.compute(key, (k, old) -> {
            if (old == null || old.windowStartEpoch + windowSeconds <= now) {
                return new Bucket(now, 1);
            }
            return new Bucket(old.windowStartEpoch, old.count + 1);
        });
        if (bucket.count > maxRequests) {
            throw new ApiTooManyRequestsException("Too Many Requests");
        }
    }

    private static String clientKey(HttpServletRequest request) {
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            String first = xff.split(",")[0].trim();
            if (!first.isEmpty()) {
                return first;
            }
        }
        return request.getRemoteAddr() == null ? "unknown" : request.getRemoteAddr();
    }

    private record Bucket(long windowStartEpoch, int count) {
    }
}
