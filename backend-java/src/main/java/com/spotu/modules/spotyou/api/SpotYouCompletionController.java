package com.spotu.modules.spotyou.api;

import com.spotu.modules.spotyou.service.TagPointReadService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/spot-you")
public class SpotYouCompletionController {

    private final TagPointReadService tagPointReadService;

    public SpotYouCompletionController(TagPointReadService tagPointReadService) {
        this.tagPointReadService = tagPointReadService;
    }

    @GetMapping("/my-completion-stats")
    public Map<String, Object> myCompletionStats(HttpServletRequest request) {
        return tagPointReadService.myCompletionStats(request);
    }
}
