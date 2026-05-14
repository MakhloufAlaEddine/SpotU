package com.spotu.modules.users.service;

import com.spotu.modules.auth.infra.UserMeRepository;
import com.spotu.modules.auth.service.JwtService;
import com.spotu.modules.auth.service.TokenExtractor;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

@Component
public class OptionalAuthResolver {

    private final JwtService jwtService;
    private final UserMeRepository userMeRepository;

    public OptionalAuthResolver(JwtService jwtService, UserMeRepository userMeRepository) {
        this.jwtService = jwtService;
        this.userMeRepository = userMeRepository;
    }

    public String resolveMeIdOrNull(HttpServletRequest request) {
        String token = TokenExtractor.fromRequest(request);
        if (token == null || token.isEmpty()) {
            return null;
        }
        try {
            String userId = jwtService.extractUserId(token);
            return userMeRepository.findByUserId(userId).isPresent() ? userId : null;
        } catch (Exception ignored) {
            return null;
        }
    }
}
