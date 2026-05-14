package com.spotu.modules.spotyou.api;

import com.spotu.modules.spotyou.dto.DeleteTagPointResponse;
import com.spotu.modules.spotyou.dto.ReactivateTagPointResponse;
import com.spotu.modules.spotyou.service.TagPointLifecycleService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/tag-points")
public class TagPointLifecycleController {

    private final TagPointLifecycleService lifecycleService;

    public TagPointLifecycleController(TagPointLifecycleService lifecycleService) {
        this.lifecycleService = lifecycleService;
    }

    @DeleteMapping("/{pointId}")
    public DeleteTagPointResponse softDelete(HttpServletRequest request, @PathVariable String pointId) {
        return lifecycleService.softDelete(request, pointId);
    }

    @PostMapping("/{pointId}/reactivate")
    public ReactivateTagPointResponse reactivate(HttpServletRequest request, @PathVariable String pointId) {
        return lifecycleService.reactivate(request, pointId);
    }
}

