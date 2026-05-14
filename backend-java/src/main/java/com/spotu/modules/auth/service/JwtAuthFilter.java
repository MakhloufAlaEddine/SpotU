package com.spotu.modules.auth.service;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Parse JWT best-effort et expose le payload en attribut de requête.
 */
@Component
@ConditionalOnBean(JwtService.class)
public class JwtAuthFilter extends OncePerRequestFilter {

    public static final String REQUEST_JWT_PAYLOAD_ATTR = "jwt_payload";

    private final JwtService jwtService;

    public JwtAuthFilter(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        String token = TokenExtractor.fromRequest(request);
        if (token != null && !token.isBlank()) {
            try {
                request.setAttribute(REQUEST_JWT_PAYLOAD_ATTR, jwtService.decodePayload(token));
            } catch (Exception ignored) {
                // ne bloque pas les routes publiques ; require_auth gère l'erreur détaillée.
            }
        }
        filterChain.doFilter(request, response);
    }
}
