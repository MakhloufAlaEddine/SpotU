package com.spotu.modules.users.api;

import com.spotu.modules.users.dto.FollowerItemDto;
import com.spotu.modules.users.dto.FollowingItemDto;
import com.spotu.modules.users.service.FollowListService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/users")
public class FollowListController {

    private final FollowListService followListService;

    public FollowListController(FollowListService followListService) {
        this.followListService = followListService;
    }

    @GetMapping("/{userId}/followers")
    public List<FollowerItemDto> followers(@PathVariable String userId, HttpServletRequest request) {
        return followListService.listFollowers(userId, request);
    }

    @GetMapping("/{userId}/following")
    public List<FollowingItemDto> following(@PathVariable String userId, HttpServletRequest request) {
        return followListService.listFollowing(userId, request);
    }
}
