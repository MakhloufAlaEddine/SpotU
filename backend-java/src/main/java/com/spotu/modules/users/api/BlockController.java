package com.spotu.modules.users.api;

import com.spotu.modules.users.dto.BlockResponseDto;
import com.spotu.modules.users.service.BlockService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/users")
public class BlockController {

    private final BlockService blockService;

    public BlockController(BlockService blockService) {
        this.blockService = blockService;
    }

    @PostMapping("/{userId}/block")
    public BlockResponseDto block(@PathVariable String userId, HttpServletRequest request) {
        return blockService.block(request, userId);
    }

    @DeleteMapping("/{userId}/block")
    public BlockResponseDto unblock(@PathVariable String userId, HttpServletRequest request) {
        return blockService.unblock(request, userId);
    }
}
