package com.spotu.modules.users.service;

import com.spotu.error.ApiBadRequestException;
import com.spotu.error.ApiNotFoundException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.users.dto.FollowResponseDto;
import com.spotu.modules.users.infra.FollowRepository;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;

@Service
public class FollowService {

    private static final String SELF_FOLLOW_ERROR = "Vous ne pouvez pas vous suivre vous-même.";
    private static final String TARGET_NOT_FOUND_ERROR = "Utilisateur introuvable.";

    private final AuthMeService authMeService;
    private final FollowRepository followRepository;

    public FollowService(AuthMeService authMeService, FollowRepository followRepository) {
        this.authMeService = authMeService;
        this.followRepository = followRepository;
    }

    public FollowResponseDto follow(HttpServletRequest request, String targetUserId) {
        CurrentUserDto me = authMeService.requireCurrentUser(request);
        if (me.userId().equals(targetUserId)) {
            throw new ApiBadRequestException(SELF_FOLLOW_ERROR);
        }
        if (!followRepository.targetExists(targetUserId)) {
            throw new ApiNotFoundException(TARGET_NOT_FOUND_ERROR);
        }
        followRepository.followIdempotent(me.userId(), targetUserId);
        int followersCount = followRepository.countFollowers(targetUserId);
        return new FollowResponseDto(true, followersCount);
    }

    public FollowResponseDto unfollow(HttpServletRequest request, String targetUserId) {
        CurrentUserDto me = authMeService.requireCurrentUser(request);
        followRepository.unfollow(me.userId(), targetUserId);
        int followersCount = followRepository.countFollowers(targetUserId);
        return new FollowResponseDto(false, followersCount);
    }
}
