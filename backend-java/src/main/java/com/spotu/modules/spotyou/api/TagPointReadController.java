package com.spotu.modules.spotyou.api;

import com.spotu.modules.spotyou.service.TagPointReadService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/tag-points")
public class TagPointReadController {

    private final TagPointReadService tagPointReadService;

    public TagPointReadController(TagPointReadService tagPointReadService) {
        this.tagPointReadService = tagPointReadService;
    }

    @GetMapping("/mine")
    public List<Map<String, Object>> mine(HttpServletRequest request) {
        return tagPointReadService.mine(request);
    }

    @GetMapping("/saved")
    public List<Map<String, Object>> saved(HttpServletRequest request) {
        return tagPointReadService.saved(request);
    }

    @GetMapping("/{pointId}/similar")
    public List<Map<String, Object>> similar(HttpServletRequest request, @PathVariable String pointId) {
        return tagPointReadService.similar(request, pointId);
    }

    @GetMapping("/{pointId}/participants")
    public List<Map<String, Object>> participants(@PathVariable String pointId) {
        return tagPointReadService.participants(pointId);
    }

    @GetMapping("/{pointId}/my-vote")
    public Map<String, Object> myVote(HttpServletRequest request, @PathVariable String pointId) {
        return tagPointReadService.myVote(request, pointId);
    }

    @GetMapping("/{pointId}/votes")
    public List<Map<String, Object>> votes(@PathVariable String pointId) {
        return tagPointReadService.votes(pointId);
    }

    @GetMapping("/{pointId}")
    public Map<String, Object> detail(HttpServletRequest request, @PathVariable String pointId) {
        return tagPointReadService.detail(request, pointId);
    }

    @GetMapping
    public List<Map<String, Object>> search(
            HttpServletRequest request,
            @RequestParam(required = false) Double lat,
            @RequestParam(required = false) Double lng,
            @RequestParam(required = false) Integer radius,
            @RequestParam(required = false) String domain_id,
            @RequestParam(required = false) String tag_ids
    ) {
        return tagPointReadService.search(request, lat, lng, radius, domain_id, tag_ids);
    }
}
