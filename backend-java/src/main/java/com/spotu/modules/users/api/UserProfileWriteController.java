package com.spotu.modules.users.api;

import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.users.service.UserProfileWriteService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/users")
public class UserProfileWriteController {

    private final AuthMeService authMeService;
    private final UserProfileWriteService service;

    public UserProfileWriteController(AuthMeService authMeService, UserProfileWriteService service) {
        this.authMeService = authMeService;
        this.service = service;
    }

    @PutMapping(value = "/profile", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> updateProfile(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        return service.updateProfile(authMeService.requireCurrentUser(request), body);
    }

    @PostMapping("/become-coach")
    public Map<String, Object> becomeCoach(HttpServletRequest request) {
        return service.becomeCoach(authMeService.requireCurrentUser(request));
    }

    @PatchMapping(value = "/{userId}/cover", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> updateCover(
            @PathVariable String userId,
            @RequestBody Map<String, Object> body,
            HttpServletRequest request
    ) {
        return service.updateCover(
                authMeService.requireCurrentUser(request),
                userId,
                body.get("cover_picture") == null ? "" : String.valueOf(body.get("cover_picture")),
                body.get("cover_offset_y"),
                body.get("cover_scale")
        );
    }
}

