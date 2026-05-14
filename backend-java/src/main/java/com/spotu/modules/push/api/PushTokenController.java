package com.spotu.modules.push.api;

import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.push.service.PushTokenService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class PushTokenController {

    private final AuthMeService authMeService;
    private final PushTokenService pushTokenService;

    public PushTokenController(AuthMeService authMeService, PushTokenService pushTokenService) {
        this.authMeService = authMeService;
        this.pushTokenService = pushTokenService;
    }

    @PostMapping(value = "/push-token", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> register(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        return pushTokenService.register(
                authMeService.requireCurrentUser(request),
                body.get("token") == null ? null : String.valueOf(body.get("token")),
                body.get("platform") == null ? "expo" : String.valueOf(body.get("platform"))
        );
    }

    @DeleteMapping(value = "/push-token", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> unregister(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        return pushTokenService.unregister(
                authMeService.requireCurrentUser(request),
                body.get("token") == null ? null : String.valueOf(body.get("token"))
        );
    }
}

