package com.spotu.modules.push.service;

import com.spotu.error.ApiBadRequestException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.push.infra.PushTokenRepository;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;

@Service
public class PushTokenService {

    private final PushTokenRepository repository;

    public PushTokenService(PushTokenRepository repository) {
        this.repository = repository;
    }

    public Map<String, Object> register(CurrentUserDto user, String token, String platform) {
        if (token == null || !token.startsWith("ExponentPushToken[")) {
            throw new ApiBadRequestException("Token Expo invalide");
        }
        String resolvedPlatform = (platform == null || platform.isBlank()) ? "expo" : platform;
        var existing = repository.findByToken(token);
        if (existing.isPresent()) {
            if (!user.userId().equals(existing.get().userId())) {
                repository.deactivateByToken(token);
            } else {
                repository.reactivateByToken(token);
                return Map.of("status", "updated");
            }
        }

        repository.transferOrInsert(newTokenId(), user.userId(), token, resolvedPlatform);
        return Map.of("status", "registered");
    }

    public Map<String, Object> unregister(CurrentUserDto user, String token) {
        repository.deactivateByTokenAndUser(token, user.userId());
        return Map.of("status", "unregistered");
    }

    private static String newTokenId() {
        return "ptk_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }
}

