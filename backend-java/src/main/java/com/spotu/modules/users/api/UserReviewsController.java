package com.spotu.modules.users.api;

import com.spotu.modules.users.dto.UserReviewItemDto;
import com.spotu.modules.users.service.UserReviewsService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/users")
public class UserReviewsController {

    private final UserReviewsService userReviewsService;

    public UserReviewsController(UserReviewsService userReviewsService) {
        this.userReviewsService = userReviewsService;
    }

    @GetMapping("/{userId}/reviews")
    public List<UserReviewItemDto> getUserReviews(@PathVariable String userId) {
        return userReviewsService.getUserReviews(userId);
    }
}
