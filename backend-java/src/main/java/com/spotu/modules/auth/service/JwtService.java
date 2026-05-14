package com.spotu.modules.auth.service;

import com.spotu.error.ApiAuthException;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.MalformedJwtException;
import io.jsonwebtoken.UnsupportedJwtException;
import io.jsonwebtoken.security.SignatureException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Décode JWT HS256 comme {@code decode_jwt} / PyJWT ({@code algorithms=[HS256]}, claims requis {@code exp}, {@code user_id}).
 */
@Service
public class JwtService {

    private final SecretKey secretKey;
    private static final long JWT_EXPIRE_DAYS = 7;

    public JwtService(@Value("${app.jwt.secret}") String jwtSecret) {
        if (jwtSecret == null || jwtSecret.isBlank()) {
            throw new IllegalStateException(
                    "CRITICAL: app.jwt.secret / JWT_SECRET must be set (same as Python backend).");
        }
        this.secretKey = new SecretKeySpec(jwtSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    }

    /**
     * @return {@code user_id} issu du payload
     */
    public String extractUserId(String token) {
        return decodePayload(token).get("user_id").toString();
    }

    public Map<String, Object> decodePayload(String token) {
        try {
            var jws = Jwts.parser()
                    .verifyWith(secretKey)
                    .build()
                    .parseSignedClaims(token);
            var claims = jws.getPayload();
            if (claims.getExpiration() == null) {
                throw new ApiAuthException("Invalid token");
            }
            String userId = claims.get("user_id", String.class);
            if (userId == null || userId.isBlank()) {
                throw new ApiAuthException("Invalid token");
            }
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("user_id", userId);
            payload.put("role", claims.get("role", String.class));
            payload.put("exp", claims.getExpiration().toInstant().getEpochSecond());
            return payload;
        } catch (ExpiredJwtException e) {
            throw new ApiAuthException("Token expired");
        } catch (UnsupportedJwtException e) {
            throw new ApiAuthException("Invalid token algorithm");
        } catch (MalformedJwtException | SignatureException e) {
            throw new ApiAuthException("Invalid token");
        } catch (JwtException e) {
            throw new ApiAuthException("Invalid token");
        }
    }

    public String createJwt(String userId, String role) {
        Instant exp = Instant.now().plus(JWT_EXPIRE_DAYS, ChronoUnit.DAYS);
        return Jwts.builder()
                .claim("user_id", userId)
                .claim("role", role)
                .expiration(Date.from(exp))
                .signWith(secretKey, Jwts.SIG.HS256)
                .compact();
    }
}
