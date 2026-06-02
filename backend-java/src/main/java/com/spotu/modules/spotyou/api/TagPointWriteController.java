package com.spotu.modules.spotyou.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.modules.spotyou.dto.TagPointCreateRequest;
import com.spotu.modules.spotyou.service.TagPointWriteService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/tag-points")
public class TagPointWriteController {

    private final TagPointWriteService tagPointWriteService;
    private final ObjectMapper objectMapper;

    public TagPointWriteController(TagPointWriteService tagPointWriteService, ObjectMapper objectMapper) {
        this.tagPointWriteService = tagPointWriteService;
        this.objectMapper = objectMapper;
    }

    @PostMapping
    public Map<String, Object> create(
            HttpServletRequest request,
            @Valid @RequestBody TagPointCreateRequest body
    ) {
        return tagPointWriteService.create(request, body);
    }

    @PutMapping("/{pointId}")
    public Map<String, Object> update(
            HttpServletRequest request,
            @PathVariable String pointId,
            @RequestBody(required = false) JsonNode body
    ) {
        JsonNode n = body == null ? objectMapper.createObjectNode() : body;
        return tagPointWriteService.update(request, pointId, n);
    }

    @PatchMapping("/{pointId}/new-date")
    public Map<String, Object> toggleNewDateComing(HttpServletRequest request, @PathVariable String pointId) {
        return tagPointWriteService.toggleNewDateComing(request, pointId);
    }

    @PostMapping("/{pointId}/vote")
    public Map<String, Object> vote(
            HttpServletRequest request,
            @PathVariable String pointId,
            @RequestBody(required = false) Map<String, Object> body
    ) {
        return tagPointWriteService.vote(request, pointId, body);
    }
}
