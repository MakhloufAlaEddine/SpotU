package com.spotu.modules.auth.api;

import com.spotu.error.ApiBadRequestException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.service.AuthRateLimiter;
import com.spotu.modules.auth.service.AuthService;
import com.spotu.modules.auth.service.AuthMeService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.UriUtils;

import java.nio.charset.StandardCharsets;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthMeService authMeService;
    private final AuthService authService;
    private final AuthRateLimiter authRateLimiter;

    public AuthController(
            AuthMeService authMeService,
            AuthService authService,
            AuthRateLimiter authRateLimiter
    ) {
        this.authMeService = authMeService;
        this.authService = authService;
        this.authRateLimiter = authRateLimiter;
    }

    @GetMapping("/native-callback")
    public org.springframework.http.ResponseEntity<Void> nativeCallback(HttpServletRequest request) {
        String sessionId = request.getParameter("session_id");
        String expCallbackRaw = request.getParameter("exp_callback");
        String expCallback = expCallbackRaw == null ? "" : UriUtils.decode(expCallbackRaw, StandardCharsets.UTF_8);
        if (sessionId == null || sessionId.isBlank() || expCallback.isBlank()) {
            throw new ApiBadRequestException("Missing session_id or exp_callback");
        }
        String target = expCallback + "?session_id=" + sessionId;
        return org.springframework.http.ResponseEntity.status(302)
                .header("Location", target)
                .build();
    }

    @PostMapping(value = "/register", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> register(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        authRateLimiter.check(request, "auth_register", 5, 60);
        String email = asString(body.get("email"));
        String password = asString(body.get("password"));
        String name = asString(body.get("name"));
        String language = asString(body.get("language"));
        return authService.register(email, password, name, language);
    }

    @PostMapping(value = "/login", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> login(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        authRateLimiter.check(request, "auth_login", 5, 60);
        return authService.login(asString(body.get("email")), asString(body.get("password")));
    }

    @PostMapping(value = "/google", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> google(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        authRateLimiter.check(request, "auth_google", 10, 60);
        return authService.googleAuth(asString(body.get("session_id")));
    }

    @GetMapping("/me")
    public CurrentUserDto getMe(HttpServletRequest request) {
        return authMeService.requireCurrentUser(request);
    }

    @PostMapping("/logout")
    public Map<String, Object> logout(HttpServletRequest request) {
        return authService.logout(authMeService.requireCurrentUser(request));
    }

    @PutMapping(value = "/change-password", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> changePassword(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        return authService.changePassword(
                user,
                asString(body.get("current_password")),
                asString(body.get("new_password"))
        );
    }

    private static String asString(Object v) {
        if (v == null) {
            return null;
        }
        return String.valueOf(v);
    }
}
