package com.spotu.modules.users.api;

import com.spotu.modules.spotyou.service.SpotYouMembershipService;
import com.spotu.modules.spotyou.service.TagPointReadService;
import com.spotu.modules.users.dto.UserProfileDto;
import com.spotu.modules.users.service.ActivityFeedService;
import com.spotu.modules.users.service.UserProfileService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/users")
public class UserProfileController {

    private final UserProfileService userProfileService;
    private final ActivityFeedService activityFeedService;
    private final TagPointReadService tagPointReadService;
    private final SpotYouMembershipService spotYouMembershipService;

    public UserProfileController(
            UserProfileService userProfileService,
            ActivityFeedService activityFeedService,
            TagPointReadService tagPointReadService,
            SpotYouMembershipService spotYouMembershipService
    ) {
        this.userProfileService = userProfileService;
        this.activityFeedService = activityFeedService;
        this.tagPointReadService = tagPointReadService;
        this.spotYouMembershipService = spotYouMembershipService;
    }

    @GetMapping("/me")
    public UserProfileDto getMe(HttpServletRequest request) {
        return userProfileService.getMyProfile(request);
    }

    @GetMapping("/profile")
    public UserProfileDto getProfileAlias(HttpServletRequest request) {
        return userProfileService.getMyProfile(request);
    }

    @GetMapping("/me/pending-requests")
    public List<Map<String, Object>> pendingSpotYouRequests(HttpServletRequest request) {
        return tagPointReadService.pendingRequests(request);
    }

    @GetMapping("/me/spotyou-invitations")
    public List<Map<String, Object>> spotYouInvitations(HttpServletRequest request) {
        return spotYouMembershipService.myInvitations(request);
    }

    @GetMapping("/me/activity-feed")
    public Map<String, List<Map<String, Object>>> activityFeed(HttpServletRequest request) {
        return activityFeedService.getActivityFeed(request);
    }
}
