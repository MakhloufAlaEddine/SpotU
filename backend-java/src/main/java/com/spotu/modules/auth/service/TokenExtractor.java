package com.spotu.modules.auth.service;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;

/**
 * Même ordre que {@code get_token_from_request} dans {@code auth_utils.py}.
 */
public final class TokenExtractor {

    private TokenExtractor() {
    }

    public static String fromRequest(HttpServletRequest request) {
        String auth = request.getHeader("Authorization");
        if (auth == null) {
            auth = "";
        }
        if (auth.startsWith("Bearer ")) {
            return auth.substring(7);
        }
        Cookie[] cookies = request.getCookies();
        if (cookies != null) {
            for (Cookie c : cookies) {
                if ("winek_token".equals(c.getName())) {
                    return c.getValue();
                }
            }
        }
        return null;
    }
}
