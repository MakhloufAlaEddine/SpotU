package com.spotu.modules.referential.api;

import com.spotu.modules.referential.dto.DomainDto;
import com.spotu.modules.referential.dto.TagCategoryDto;
import com.spotu.modules.referential.dto.TagDto;
import com.spotu.modules.referential.service.ReferentialService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api")
public class ReferentialController {

    private final ReferentialService referentialService;

    public ReferentialController(ReferentialService referentialService) {
        this.referentialService = referentialService;
    }

    @GetMapping("/domains")
    public ResponseEntity<List<DomainDto>> getDomains(
            @RequestParam(name = "include_inactive", defaultValue = "false") boolean includeInactive
    ) {
        return ResponseEntity.ok(referentialService.getDomains(includeInactive));
    }

    @GetMapping("/tags/categories")
    public ResponseEntity<List<TagCategoryDto>> getTagCategories(
            @RequestParam(name = "domain_id", required = false) String domainId,
            @RequestParam(name = "entity_type", required = false) String entityType
    ) {
        return ResponseEntity.ok(referentialService.getTagCategories(domainId, entityType));
    }

    @GetMapping("/tags")
    public ResponseEntity<List<TagDto>> getTags(
            @RequestParam(name = "domain_id", required = false) String domainId,
            @RequestParam(name = "category_id", required = false) String categoryId,
            @RequestParam(name = "entity_type", required = false) String entityType
    ) {
        return ResponseEntity.ok(referentialService.getTags(domainId, categoryId, entityType));
    }
}
