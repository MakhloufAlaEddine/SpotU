package com.spotu.modules.notifications.api;

import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.notifications.dto.NotificationInboxItemDto;
import com.spotu.modules.notifications.service.NotificationsService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/users/me/notifications")
public class NotificationsController {

    private final AuthMeService authMeService;
    private final NotificationsService notificationsService;

    public NotificationsController(AuthMeService authMeService, NotificationsService notificationsService) {
        this.authMeService = authMeService;
        this.notificationsService = notificationsService;
    }

    @GetMapping
    public ResponseEntity<List<NotificationInboxItemDto>> list(
            @RequestParam(name = "limit", required = false) String limitRaw,
            HttpServletRequest request
    ) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        int limit = parseLimit(limitRaw);
        return ResponseEntity.ok(notificationsService.listInbox(user.userId(), limit));
    }

    @PatchMapping("/{notifId}/read")
    public ResponseEntity<Map<String, Object>> markRead(@PathVariable String notifId, HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        return ResponseEntity.ok(notificationsService.markRead(user.userId(), notifId));
    }

    @PatchMapping("/read-all")
    public ResponseEntity<Map<String, Object>> markAllRead(HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        return ResponseEntity.ok(notificationsService.markAllRead(user.userId()));
    }

    private int parseLimit(String limitRaw) {
        if (limitRaw == null || limitRaw.isBlank()) {
            return 50;
        }
        final int parsed;
        try {
            parsed = Integer.parseInt(limitRaw);
        } catch (NumberFormatException ex) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Invalid limit");
        }
        if (parsed < 1 || parsed > 200) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Invalid limit");
        }
        return parsed;
    }
}
