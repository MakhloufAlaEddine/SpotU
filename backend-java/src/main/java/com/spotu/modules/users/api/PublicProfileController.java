package com.spotu.modules.users.api;

import com.spotu.modules.users.dto.PublicProfileDto;
import com.spotu.modules.users.service.PublicProfileService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/users")
public class PublicProfileController {

    private final PublicProfileService publicProfileService;

    public PublicProfileController(PublicProfileService publicProfileService) {
        this.publicProfileService = publicProfileService;
    }

    @GetMapping("/{userId}/public")
    public PublicProfileDto getPublicProfile(@PathVariable String userId, HttpServletRequest request) {
        return publicProfileService.getPublicProfile(userId, request);
    }
}
