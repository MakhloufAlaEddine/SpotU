package com.spotu.modules.referential.service;

import com.spotu.modules.referential.dto.DomainDto;
import com.spotu.modules.referential.dto.TagCategoryDto;
import com.spotu.modules.referential.dto.TagDto;
import com.spotu.modules.referential.infra.ReferentialRepository;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

@Service
public class ReferentialService {

    private final ReferentialRepository repository;

    public ReferentialService(ReferentialRepository repository) {
        this.repository = repository;
    }

    public List<DomainDto> getDomains(boolean includeInactive) {
        return repository.findDomains(includeInactive);
    }

    public List<TagCategoryDto> getTagCategories(String domainId, String entityType) {
        List<TagCategoryDto> categories = repository.findActiveCategories(domainId, entityType);
        if (categories.isEmpty()) {
            return Collections.emptyList();
        }
        List<String> categoryIds = categories.stream().map(TagCategoryDto::categoryId).toList();
        Map<String, List<TagDto>> tagsByCategory = repository.findActiveTagsByCategoryIds(categoryIds);

        List<TagCategoryDto> out = new ArrayList<>();
        for (TagCategoryDto category : categories) {
            out.add(new TagCategoryDto(
                    category.categoryId(),
                    category.domainId(),
                    category.entityType(),
                    category.name(),
                    category.labelFr(),
                    category.labelEn(),
                    category.icon(),
                    category.active(),
                    category.createdAt(),
                    tagsByCategory.getOrDefault(category.categoryId(), Collections.emptyList())
            ));
        }
        return out;
    }

    public List<TagDto> getTags(String domainId, String categoryId, String entityType) {
        return repository.findTags(domainId, categoryId, entityType);
    }
}
