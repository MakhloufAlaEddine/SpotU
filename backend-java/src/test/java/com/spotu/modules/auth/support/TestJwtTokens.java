package com.spotu.modules.auth.support;

import io.jsonwebtoken.Jwts;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.Map;

/**
 * Génération de JWT de test (même secret HS256 que le profil {@code test}).
 */
public final class TestJwtTokens {

    public static final String TEST_SECRET = "unit-test-jwt-secret-32-bytes-lo!";

    private TestJwtTokens() {
    }

    public static SecretKey secretKey(String secret) {
        return new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    }

    public static String validCoachToken() {
        return hs256Token(
                TEST_SECRET,
                Map.of("user_id", "user_demo001", "role", "coach"),
                Instant.now().plusSeconds(3600));
    }

    public static String validAdminToken() {
        return hs256Token(
                TEST_SECRET,
                Map.of("user_id", "user_admin001", "role", "admin"),
                Instant.now().plusSeconds(3600));
    }

    public static String validUserToken() {
        return hs256Token(
                TEST_SECRET,
                Map.of("user_id", "user_private001", "role", "user"),
                Instant.now().plusSeconds(3600));
    }

    public static String validZoeToken() {
        return hs256Token(
                TEST_SECRET,
                Map.of("user_id", "user_zoe001", "role", "user"),
                Instant.now().plusSeconds(3600));
    }

    public static String expiredToken() {
        return hs256Token(
                TEST_SECRET,
                Map.of("user_id", "user_demo001", "role", "coach"),
                Instant.now().minusSeconds(10));
    }

    public static String wrongSignatureToken() {
        return hs256Token(
                "wrong-secret-32-bytes-xxxxxxxxxx!!",
                Map.of("user_id", "user_demo001", "role", "coach"),
                Instant.now().plusSeconds(3600));
    }

    public static String missingUserIdToken() {
        return Jwts.builder()
                .claim("role", "coach")
                .expiration(Date.from(Instant.now().plusSeconds(3600)))
                .signWith(secretKey(TEST_SECRET), Jwts.SIG.HS256)
                .compact();
    }

    public static String missingExpToken() {
        return Jwts.builder()
                .claims(Map.of("user_id", "user_demo001", "role", "coach"))
                .signWith(secretKey(TEST_SECRET), Jwts.SIG.HS256)
                .compact();
    }

    public static String unknownUserToken() {
        return hs256Token(
                TEST_SECRET,
                Map.of("user_id", "user_inexistant_xyz", "role", "user"),
                Instant.now().plusSeconds(3600));
    }

    public static String rs256HeaderToken() {
        String header = java.util.Base64.getUrlEncoder().withoutPadding()
                .encodeToString("{\"alg\":\"RS256\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
        String payload = java.util.Base64.getUrlEncoder().withoutPadding()
                .encodeToString(
                        ("{\"user_id\":\"user_demo001\",\"exp\":" + (Instant.now().getEpochSecond() + 3600) + "}")
                                .getBytes(StandardCharsets.UTF_8));
        return header + "." + payload + ".bogus";
    }

    private static String hs256Token(String secret, Map<String, ?> claims, Instant exp) {
        return Jwts.builder()
                .claims(claims)
                .expiration(Date.from(exp))
                .signWith(secretKey(secret), Jwts.SIG.HS256)
                .compact();
    }
}
