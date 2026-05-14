package com.spotu.modules.auth.service;

import com.spotu.error.ApiAuthException;
import com.spotu.error.ApiBadRequestException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.infra.UserMeRepository;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@Service
public class AuthService {

    private final UserMeRepository userRepository;
    private final JwtService jwtService;
    private final EmergentOAuthClient emergentOAuthClient;
    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder(12);

    public AuthService(
            UserMeRepository userRepository,
            JwtService jwtService,
            EmergentOAuthClient emergentOAuthClient
    ) {
        this.userRepository = userRepository;
        this.jwtService = jwtService;
        this.emergentOAuthClient = emergentOAuthClient;
    }

    public Map<String, Object> register(String email, String password, String name, String language) {
        String normalizedEmail = normalizeEmail(email);
        String normalizedName = validateName(name);
        validatePassword(password);
        String lang = validateLanguage(language == null || language.isBlank() ? "fr" : language);

        if (userRepository.findUserIdByEmail(normalizedEmail).isPresent()) {
            throw new ApiBadRequestException("Email already registered");
        }

        String userId = newUserId();
        userRepository.insertLocalUser(
                userId,
                normalizedEmail,
                hashPassword(password),
                normalizedName,
                lang
        );
        Map<String, Object> user = userRepository.findUserMapByUserId(userId)
                .orElseThrow(() -> new IllegalStateException("User introuvable après register"));
        return authResponse(user, jwtService.createJwt(userId, "user"));
    }

    public Map<String, Object> login(String email, String password) {
        String normalizedEmail = normalizeEmail(email);
        var creds = userRepository.findCredentialsByEmail(normalizedEmail).orElse(null);
        if (creds == null || !verifyPassword(password, creds.passwordHash() == null ? "" : creds.passwordHash())) {
            throw new ApiAuthException("Invalid credentials");
        }
        Map<String, Object> user = userRepository.findUserMapByUserId(creds.userId())
                .orElseThrow(() -> new ApiAuthException("Invalid credentials"));
        return authResponse(user, jwtService.createJwt(creds.userId(), creds.role()));
    }

    public Map<String, Object> googleAuth(String sessionId) {
        Map<String, Object> session = emergentOAuthClient.fetchSession(sessionId);
        String email = normalizeEmail(String.valueOf(session.getOrDefault("email", "")));
        String name = String.valueOf(session.getOrDefault("name", ""));
        String picture = session.get("picture") == null ? null : String.valueOf(session.get("picture"));

        var existing = userRepository.findUserMapByEmail(email);
        if (existing.isPresent()) {
            userRepository.updateGoogleIdentity(email, name, picture);
            Map<String, Object> user = userRepository.findUserMapByEmail(email)
                    .orElseThrow(() -> new IllegalStateException("User introuvable après update google"));
            return authResponse(user, jwtService.createJwt(String.valueOf(user.get("user_id")), String.valueOf(user.get("role"))));
        }

        String userId = newUserId();
        userRepository.insertGoogleUser(userId, email, name, picture);
        Map<String, Object> user = userRepository.findUserMapByUserId(userId)
                .orElseThrow(() -> new IllegalStateException("User introuvable après insert google"));
        return authResponse(user, jwtService.createJwt(userId, "user"));
    }

    public Map<String, Object> logout(CurrentUserDto ignored) {
        return Map.of("success", true);
    }

    public Map<String, Object> changePassword(CurrentUserDto user, String currentPassword, String newPassword) {
        validatePassword(newPassword);
        String existingHash = userRepository.findPasswordHashByUserId(user.userId()).orElse("");
        if (!verifyPassword(currentPassword, existingHash == null ? "" : existingHash)) {
            throw new ApiAuthException("Mot de passe actuel incorrect");
        }
        userRepository.updatePasswordHash(user.userId(), hashPassword(newPassword));
        return Map.of("success", true);
    }

    private static String normalizeEmail(String email) {
        if (email == null) {
            return "";
        }
        return email.toLowerCase();
    }

    private static String validateName(String name) {
        if (name == null || name.trim().isEmpty()) {
            throw new ApiBadRequestException("Le nom est obligatoire");
        }
        return name.trim();
    }

    private static String validateLanguage(String language) {
        if ("fr".equals(language) || "en".equals(language)) {
            return language;
        }
        throw new ApiBadRequestException("Input should be 'fr' or 'en'");
    }

    private static void validatePassword(String password) {
        if (password == null || password.length() < 6) {
            throw new ApiBadRequestException("Le mot de passe doit contenir au moins 6 caractères");
        }
    }

    private String hashPassword(String password) {
        return passwordEncoder.encode(password);
    }

    /**
     * Alignement auth_utils.verify_password : ne jette jamais, retourne false.
     */
    private boolean verifyPassword(String password, String hashed) {
        try {
            if (hashed == null || hashed.isBlank()) {
                return false;
            }
            return passwordEncoder.matches(password, hashed);
        } catch (Exception e) {
            return false;
        }
    }

    private static String newUserId() {
        return "user_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }

    private static Map<String, Object> authResponse(Map<String, Object> user, String token) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("user", user);
        out.put("token", token);
        return out;
    }
}
