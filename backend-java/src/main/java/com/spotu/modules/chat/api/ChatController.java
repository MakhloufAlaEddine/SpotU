package com.spotu.modules.chat.api;

import com.spotu.modules.chat.service.ChatService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class ChatController {
    private final ChatService chatService;

    public ChatController(ChatService chatService) {
        this.chatService = chatService;
    }

    @PostMapping("/conversations")
    public ResponseEntity<Map<String, Object>> createConversation(
            @RequestBody(required = false) Map<String, Object> body,
            HttpServletRequest request
    ) {
        return ResponseEntity.ok(chatService.createConversation(request, body));
    }

    @GetMapping("/conversations")
    public ResponseEntity<List<Map<String, Object>>> listConversations(HttpServletRequest request) {
        return ResponseEntity.ok(chatService.listConversations(request));
    }

    @GetMapping("/conversations/{convId}/messages")
    public ResponseEntity<List<Map<String, Object>>> listMessages(
            @PathVariable String convId,
            @RequestParam(name = "limit", required = false) String limit,
            @RequestParam(name = "before", required = false) String before,
            HttpServletRequest request
    ) {
        return ResponseEntity.ok(chatService.listMessages(request, convId, limit, before));
    }

    @PutMapping("/conversations/{convId}/read")
    public ResponseEntity<Map<String, Object>> markRead(@PathVariable String convId, HttpServletRequest request) {
        return ResponseEntity.ok(chatService.markConversationRead(request, convId));
    }

    @DeleteMapping("/messages/{messageId}")
    public ResponseEntity<Map<String, Object>> deleteMessage(@PathVariable String messageId, HttpServletRequest request) {
        return ResponseEntity.ok(chatService.deleteMessage(request, messageId));
    }

    @PatchMapping("/conversations/{convId}/leave")
    public ResponseEntity<Map<String, Object>> leaveConversation(@PathVariable String convId, HttpServletRequest request) {
        return ResponseEntity.ok(chatService.leaveConversation(request, convId));
    }
}
