package com.spotu.modules.users.api;

import com.spotu.modules.users.dto.FollowResponseDto;
import com.spotu.modules.users.service.FollowService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/users")
public class FollowController {

    private final FollowService followService;

    public FollowController(FollowService followService) {
        this.followService = followService;
    }

    @PostMapping("/{userId}/follow")
    public FollowResponseDto follow(@PathVariable String userId, HttpServletRequest request) {
        return followService.follow(request, userId);
    }

    @DeleteMapping("/{userId}/follow")
    public FollowResponseDto unfollow(@PathVariable String userId, HttpServletRequest request) {
        return followService.unfollow(request, userId);
    }
}
