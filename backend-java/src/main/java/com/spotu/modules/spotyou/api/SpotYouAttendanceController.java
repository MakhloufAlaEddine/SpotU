package com.spotu.modules.spotyou.api;

import com.spotu.modules.spotyou.service.TagPointReadService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/spot-you")
public class SpotYouAttendanceController {

    private final TagPointReadService tagPointReadService;

    public SpotYouAttendanceController(TagPointReadService tagPointReadService) {
        this.tagPointReadService = tagPointReadService;
    }

    @GetMapping("/{pointId}/going")
    public Map<String, Object> getGoing(@PathVariable String pointId) {
        return tagPointReadService.getGoingForNextSession(pointId);
    }

    @PostMapping("/{pointId}/going")
    public Map<String, Object> markGoing(@PathVariable String pointId, HttpServletRequest request) {
        return tagPointReadService.markGoing(pointId, request);
    }

    @DeleteMapping("/{pointId}/going")
    public Map<String, Object> unmarkGoing(@PathVariable String pointId, HttpServletRequest request) {
        return tagPointReadService.unmarkGoing(pointId, request);
    }
}

