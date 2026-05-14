package com.spotu.modules.users.service;

import com.spotu.error.ApiBadRequestException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.users.dto.BlockResponseDto;
import com.spotu.modules.users.infra.BlockRepository;
import com.spotu.modules.users.infra.FollowRepository;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;

@Service
public class BlockService {

    private static final String SELF_BLOCK_ERROR = "Vous ne pouvez pas vous bloquer vous-même.";

    private final AuthMeService authMeService;
    private final BlockRepository blockRepository;
    private final FollowRepository followRepository;

    public BlockService(AuthMeService authMeService, BlockRepository blockRepository, FollowRepository followRepository) {
        this.authMeService = authMeService;
        this.blockRepository = blockRepository;
        this.followRepository = followRepository;
    }

    public BlockResponseDto block(HttpServletRequest request, String targetUserId) {
        CurrentUserDto me = authMeService.requireCurrentUser(request);
        if (me.userId().equals(targetUserId)) {
            throw new ApiBadRequestException(SELF_BLOCK_ERROR);
        }
        followRepository.deleteBidirectional(me.userId(), targetUserId);
        blockRepository.blockIdempotent(me.userId(), targetUserId);
        return new BlockResponseDto(true);
    }

    public BlockResponseDto unblock(HttpServletRequest request, String targetUserId) {
        CurrentUserDto me = authMeService.requireCurrentUser(request);
        blockRepository.unblock(me.userId(), targetUserId);
        return new BlockResponseDto(false);
    }
}
