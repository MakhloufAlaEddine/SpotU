package com.spotu.modules.spotyou.api;

import com.spotu.modules.spotyou.dto.InviteBody;
import com.spotu.modules.spotyou.service.SpotYouMembershipService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/tag-points")
public class SpotYouMembershipController {

    private final SpotYouMembershipService membershipService;

    public SpotYouMembershipController(SpotYouMembershipService membershipService) {
        this.membershipService = membershipService;
    }

    @PostMapping("/{pointId}/save")
    public Map<String, Object> save(HttpServletRequest request, @PathVariable String pointId) {
        return membershipService.save(request, pointId);
    }

    @DeleteMapping("/{pointId}/unsave")
    public Map<String, Object> unsave(HttpServletRequest request, @PathVariable String pointId) {
        return membershipService.unsave(request, pointId);
    }

    @PostMapping("/{pointId}/join")
    public Map<String, Object> join(HttpServletRequest request, @PathVariable String pointId) {
        return membershipService.join(request, pointId);
    }

    @DeleteMapping("/{pointId}/cancel-request")
    public Map<String, Object> cancelRequest(HttpServletRequest request, @PathVariable String pointId) {
        return membershipService.cancelRequest(request, pointId);
    }

    @DeleteMapping("/{pointId}/leave")
    public Map<String, Object> leave(HttpServletRequest request, @PathVariable String pointId) {
        return membershipService.leave(request, pointId);
    }

    @PostMapping("/{pointId}/invite")
    public Map<String, Object> invite(
            HttpServletRequest request,
            @PathVariable String pointId,
            @RequestBody(required = false) InviteBody body
    ) {
        return membershipService.invite(request, pointId, body != null ? body.invitedUserId() : null);
    }

    @PostMapping("/{pointId}/invitations/accept")
    public Map<String, Object> acceptInvitation(HttpServletRequest request, @PathVariable String pointId) {
        return membershipService.acceptInvitation(request, pointId);
    }

    @PostMapping("/{pointId}/invitations/refuse")
    public Map<String, Object> refuseInvitation(HttpServletRequest request, @PathVariable String pointId) {
        return membershipService.refuseInvitation(request, pointId);
    }

    @GetMapping("/{pointId}/join-requests")
    public List<Map<String, Object>> joinRequests(HttpServletRequest request, @PathVariable String pointId) {
        return membershipService.joinRequests(request, pointId);
    }

    @PostMapping("/{pointId}/members/{memberId}/approve")
    public Map<String, Object> approve(
            HttpServletRequest request,
            @PathVariable String pointId,
            @PathVariable String memberId
    ) {
        return membershipService.approve(request, pointId, memberId);
    }

    @PostMapping("/{pointId}/members/{memberId}/reject")
    public Map<String, Object> reject(
            HttpServletRequest request,
            @PathVariable String pointId,
            @PathVariable String memberId
    ) {
        return membershipService.reject(request, pointId, memberId);
    }
}
