package com.spotu.modules.users.service;

import com.spotu.modules.users.dto.FollowerItemDto;
import com.spotu.modules.users.dto.FollowingItemDto;
import com.spotu.modules.users.infra.FollowListRepository;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class FollowListService {

    private final FollowListRepository followListRepository;
    private final OptionalAuthResolver optionalAuthResolver;

    public FollowListService(FollowListRepository followListRepository, OptionalAuthResolver optionalAuthResolver) {
        this.followListRepository = followListRepository;
        this.optionalAuthResolver = optionalAuthResolver;
    }

    public List<FollowerItemDto> listFollowers(String userId, HttpServletRequest request) {
        String meId = optionalAuthResolver.resolveMeIdOrNull(request);
        return followListRepository.findFollowers(userId, meId);
    }

    public List<FollowingItemDto> listFollowing(String userId, HttpServletRequest request) {
        String meId = optionalAuthResolver.resolveMeIdOrNull(request);
        return followListRepository.findFollowing(userId, meId);
    }
}
