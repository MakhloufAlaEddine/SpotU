package com.spotu.modules.auth.service;

import com.spotu.error.ApiAuthException;
import com.spotu.error.ApiForbiddenException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.infra.UserMeRepository;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;

/**
 * Équivalent synchrone de {@code require_auth(request, pool)} pour {@code GET /api/auth/me}.
 */
@Service
public class AuthMeService {

    private final JwtService jwtService;
    private final UserMeRepository userMeRepository;

    public AuthMeService(JwtService jwtService, UserMeRepository userMeRepository) {
        this.jwtService = jwtService;
        this.userMeRepository = userMeRepository;
    }

    public CurrentUserDto requireCurrentUser(HttpServletRequest request) {
        String raw = TokenExtractor.fromRequest(request);
        if (raw == null || raw.isEmpty()) {
            throw new ApiAuthException("Not authenticated");
        }
        String userId = jwtService.extractUserId(raw);
        return userMeRepository.findByUserId(userId)
                .orElseThrow(() -> new ApiAuthException("User not found"));
    }

    /**
     * Équivalent {@code require_role(request, pool, role)} pour le rôle {@code admin}.
     */
    public CurrentUserDto requireAdmin(HttpServletRequest request) {
        CurrentUserDto user = requireCurrentUser(request);
        if (!"admin".equals(user.role())) {
            throw new ApiForbiddenException("Requires admin role");
        }
        return user;
    }
}
