package com.spotu.modules.chat.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.common.JsonbMedia;
import com.spotu.error.ApiBadRequestException;
import com.spotu.error.ApiForbiddenException;
import com.spotu.error.ApiNotFoundException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.chat.infra.ChatRepository;
import com.spotu.modules.chat.ws.WsConnectionRegistry;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

import static org.springframework.http.HttpStatus.UNPROCESSABLE_ENTITY;

@Service
public class ChatService {

    private final AuthMeService authMeService;
    private final ChatRepository repository;
    private final ObjectMapper objectMapper;
    private final WsConnectionRegistry chatRegistry;
    private final WsConnectionRegistry notifRegistry;

    public ChatService(
            AuthMeService authMeService,
            ChatRepository repository,
            ObjectMapper objectMapper,
            @Qualifier("chatRegistry") WsConnectionRegistry chatRegistry,
            @Qualifier("notifRegistry") WsConnectionRegistry notifRegistry
    ) {
        this.authMeService = authMeService;
        this.repository = repository;
        this.objectMapper = objectMapper;
        this.chatRegistry = chatRegistry;
        this.notifRegistry = notifRegistry;
    }

    @Transactional
    public Map<String, Object> createConversation(HttpServletRequest request, Map<String, Object> body) {
        CurrentUserDto me = authMeService.requireCurrentUser(request);
        String type = asString(body == null ? null : body.get("type"));
        String contextId = asString(body == null ? null : body.get("context_id"));
        if (!List.of("service", "tagpoint_group", "tagpoint_private").contains(type)) {
            throw new ApiBadRequestException("Invalid conversation type");
        }
        if (contextId == null || contextId.isBlank()) {
            throw new ApiBadRequestException("Invalid context_id");
        }
        final String convId;
        if ("tagpoint_group".equals(type)) {
            if (!repository.canAccessTagpointGroup(contextId, me.userId())) {
                throw new ApiForbiddenException("Vous devez être membre de ce SpotYou pour accéder au groupe");
            }
            Optional<String> existing = repository.findGroupConversationId(contextId);
            if (existing.isPresent()) {
                convId = existing.get();
                repository.upsertParticipantActive(convId, me.userId());
            } else {
                convId = newId("conv");
                String creator = repository.findTagPointOwner(contextId).orElse(me.userId());
                String title = repository.findTagPointTitle(contextId).orElse(contextId);
                repository.insertConversation(convId, type, contextId, title, creator);
                List<String> pids = List.of(creator, me.userId()).stream().distinct().toList();
                for (String pid : pids) repository.upsertParticipantActive(convId, pid);
            }
        } else if ("tagpoint_private".equals(type)) {
            Optional<String> existing = repository.findPrivateOrServiceConversationId(type, contextId, me.userId());
            if (existing.isPresent()) {
                convId = existing.get();
            } else {
                convId = newId("conv");
                String creator = repository.findTagPointOwner(contextId).orElse(me.userId());
                String title = repository.findTagPointTitle(contextId).orElse(contextId);
                repository.insertConversation(convId, type, contextId, title, me.userId());
                List<String> pids = List.of(creator, me.userId()).stream().distinct().toList();
                for (String pid : pids) repository.insertParticipantDefaultStatus(convId, pid);
            }
        } else {
            Optional<String> existing = repository.findPrivateOrServiceConversationId(type, contextId, me.userId());
            if (existing.isPresent()) {
                convId = existing.get();
            } else {
                convId = newId("conv");
                String coach = repository.findServiceCoach(contextId).orElse(me.userId());
                String title = repository.findServiceTitle(contextId).orElse(contextId);
                repository.insertConversation(convId, type, contextId, title, me.userId());
                List<String> pids = List.of(coach, me.userId()).stream().distinct().toList();
                for (String pid : pids) repository.insertParticipantDefaultStatus(convId, pid);
            }
        }
        return normalize(repository.getConversationMeta(convId).orElseThrow(() -> new ApiNotFoundException("Conversation not found")));
    }

    public List<Map<String, Object>> listConversations(HttpServletRequest request) {
        CurrentUserDto me = authMeService.requireCurrentUser(request);
        List<Map<String, Object>> base = repository.listConversationsBase(me.userId());
        if (base.isEmpty()) return base;
        List<String> convIds = base.stream().map(r -> asString(r.get("conversation_id"))).toList();
        List<Map<String, Object>> groups = base.stream().filter(r -> "tagpoint_group".equals(asString(r.get("type")))).toList();
        List<String> groupConvIds = groups.stream().map(r -> asString(r.get("conversation_id"))).toList();
        List<String> groupCtxIds = groups.stream().map(r -> asString(r.get("context_id"))).toList();
        List<String> nongroupConvIds = base.stream().filter(r -> !"tagpoint_group".equals(asString(r.get("type")))).map(r -> asString(r.get("conversation_id"))).toList();

        CompletableFuture<List<Map<String, Object>>> lastMessagesF = CompletableFuture.supplyAsync(() -> repository.lastMessages(convIds));
        CompletableFuture<List<Map<String, Object>>> unreadF = CompletableFuture.supplyAsync(() -> repository.unreadCounts(me.userId(), convIds));
        CompletableFuture<List<Map<String, Object>>> statusF = CompletableFuture.supplyAsync(() -> repository.participantStatuses(me.userId(), convIds));
        CompletableFuture<List<Map<String, Object>>> othersF = CompletableFuture.supplyAsync(() -> repository.otherParticipants(me.userId(), nongroupConvIds));
        CompletableFuture<List<Map<String, Object>>> countF = CompletableFuture.supplyAsync(() -> repository.participantCounts(groupConvIds));
        CompletableFuture<List<Map<String, Object>>> imagesF = CompletableFuture.supplyAsync(() -> repository.groupImages(groupCtxIds));
        CompletableFuture.allOf(lastMessagesF, unreadF, statusF, othersF, countF, imagesF).join();

        Map<String, Map<String, Object>> lastByConv = lastMessagesF.join().stream()
                .collect(Collectors.toMap(r -> asString(r.get("conversation_id")), r -> r, (a, b) -> a));
        Map<String, Integer> unreadByConv = unreadF.join().stream()
                .collect(Collectors.toMap(r -> asString(r.get("conversation_id")), r -> ((Number) r.get("unread_count")).intValue(), (a, b) -> a));
        Map<String, String> statusByConv = statusF.join().stream()
                .collect(Collectors.toMap(r -> asString(r.get("conversation_id")), r -> asString(r.get("status")), (a, b) -> a));
        Map<String, Map<String, Object>> otherByConv = new LinkedHashMap<>();
        for (Map<String, Object> r : othersF.join()) otherByConv.putIfAbsent(asString(r.get("conversation_id")), normalize(r));
        Map<String, Integer> participantCountByConv = countF.join().stream()
                .collect(Collectors.toMap(r -> asString(r.get("conversation_id")), r -> ((Number) r.get("cnt")).intValue(), (a, b) -> a));
        Map<String, String> contextImageByCtx = new LinkedHashMap<>();
        for (Map<String, Object> imgRow : imagesF.join()) contextImageByCtx.put(asString(imgRow.get("point_id")), firstImage(imgRow.get("images")));

        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : base) {
            Map<String, Object> n = normalize(row);
            String convId = asString(n.get("conversation_id"));
            String type = asString(n.get("type"));
            Map<String, Object> last = lastByConv.get(convId);
            if (last != null) {
                Map<String, Object> lastN = normalize(last);
                lastN.remove("conversation_id");
                n.put("last_message", lastN);
            } else {
                n.put("last_message", null);
            }
            n.put("unread_count", unreadByConv.getOrDefault(convId, 0));
            n.put("is_blocked", "blocked".equals(statusByConv.get(convId)));
            if ("tagpoint_group".equals(type)) {
                n.put("participant_count", participantCountByConv.getOrDefault(convId, 0));
                n.put("other_participant", null);
                n.put("context_image", contextImageByCtx.get(asString(n.get("context_id"))));
            } else {
                n.put("other_participant", otherByConv.get(convId));
            }
            out.add(n);
        }
        return out;
    }

    @Transactional
    public List<Map<String, Object>> listMessages(HttpServletRequest request, String convId, String limitRaw, String beforeRaw) {
        CurrentUserDto me = authMeService.requireCurrentUser(request);
        int limit = parseLimit(limitRaw, 50, 1, 100);
        if (!repository.isParticipantAnyStatus(convId, me.userId())) {
            throw new ApiForbiddenException("Not a participant");
        }
        OffsetDateTime before = parseBefore(beforeRaw);
        List<Map<String, Object>> desc = repository.getMessages(convId, limit, before);
        List<Map<String, Object>> asc = new ArrayList<>();
        for (int i = desc.size() - 1; i >= 0; i--) asc.add(normalize(desc.get(i)));
        repository.markRead(convId, me.userId());
        pushUnread(me.userId());
        return asc;
    }

    @Transactional
    public Map<String, Object> markConversationRead(HttpServletRequest request, String convId) {
        CurrentUserDto me = authMeService.requireCurrentUser(request);
        repository.markRead(convId, me.userId());
        pushUnread(me.userId());
        return Map.of("success", true);
    }

    @Transactional
    public Map<String, Object> deleteMessage(HttpServletRequest request, String messageId) {
        CurrentUserDto me = authMeService.requireCurrentUser(request);
        Map<String, Object> msg = repository.findMessageById(messageId)
                .orElseThrow(() -> new ApiNotFoundException("Message introuvable"));
        if (msg.get("deleted_at") != null) {
            return Map.of("success", true, "already_deleted", true);
        }
        String senderId = asString(msg.get("sender_id"));
        if (!me.userId().equals(senderId) && !"admin".equals(me.role())) {
            throw new ApiForbiddenException("Non autorisé à supprimer ce message");
        }
        repository.softDeleteMessage(messageId);
        String convId = asString(msg.get("conversation_id"));
        chatRegistry.broadcast(convId, Map.of(
                "type", "message_deleted",
                "message_id", messageId,
                "conversation_id", convId
        ));
        return Map.of("success", true, "deleted", true, "message_id", messageId);
    }

    @Transactional
    public Map<String, Object> leaveConversation(HttpServletRequest request, String convId) {
        CurrentUserDto me = authMeService.requireCurrentUser(request);
        String status = repository.findParticipantStatus(convId, me.userId())
                .orElseThrow(() -> new ApiNotFoundException("Vous n'êtes pas participant de cette conversation"));
        if ("left".equals(status)) {
            return Map.of("success", true, "already_left", true);
        }
        repository.markLeft(convId, me.userId());
        if (repository.activeParticipants(convId) == 0) {
            repository.softDeleteConversationIfNeeded(convId);
        }
        return Map.of("success", true, "left", true, "conversation_id", convId);
    }

    public int unreadTotal(String userId) {
        return repository.unreadTotal(userId);
    }

    public int unreadNotif(String userId) {
        return repository.unreadNotif(userId);
    }

    public void pushUnread(String userId) {
        notifRegistry.broadcast(userId, Map.of("type", "unread_total", "count", unreadTotal(userId)));
    }

    public boolean isActiveParticipant(String convId, String userId) {
        return repository.isParticipantActive(convId, userId);
    }

    public Optional<Map<String, Object>> findUserSummary(String userId) {
        return repository.findUserSummary(userId);
    }

    public boolean isContextDeleted(String convId) {
        return repository.isContextDeleted(convId);
    }

    @Transactional
    public Map<String, Object> persistWsMessage(String convId, String senderId, String senderName, String senderPicture, String content) {
        String msgId = newId("msg");
        OffsetDateTime now = OffsetDateTime.now();
        repository.insertMessage(msgId, convId, senderId, content, now);
        repository.updateConversationLastMessageAt(convId, now);
        return Map.of(
                "message_id", msgId,
                "conversation_id", convId,
                "sender_id", senderId,
                "sender_name", senderName == null ? "" : senderName,
                "sender_picture", senderPicture,
                "content", content,
                "created_at", now.toString().replace("Z", "+00:00")
        );
    }

    public List<String> otherActiveParticipants(String convId, String senderId) {
        return repository.otherActiveParticipants(convId, senderId);
    }

    private int parseLimit(String raw, int def, int min, int max) {
        if (raw == null || raw.isBlank()) return def;
        try {
            int v = Integer.parseInt(raw);
            if (v < min || v > max) throw new NumberFormatException();
            return v;
        } catch (NumberFormatException ex) {
            throw new ResponseStatusException(UNPROCESSABLE_ENTITY, "Invalid limit");
        }
    }

    private OffsetDateTime parseBefore(String beforeRaw) {
        if (beforeRaw == null || beforeRaw.isBlank()) return null;
        try {
            return OffsetDateTime.parse(beforeRaw);
        } catch (DateTimeParseException ex) {
            throw new ResponseStatusException(UNPROCESSABLE_ENTITY, "Invalid before");
        }
    }

    private static String newId(String prefix) {
        return prefix + "_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }

    private Map<String, Object> normalize(Map<String, Object> in) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : in.entrySet()) {
            String key = e.getKey().toLowerCase(Locale.ROOT);
            Object v = e.getValue();
            if (v instanceof java.sql.Timestamp ts) {
                out.put(key, ts.toInstant().toString().replace("Z", "+00:00"));
            } else {
                out.put(key, v);
            }
        }
        return out;
    }

    private String firstImage(Object raw) {
        String u = JsonbMedia.firstImageUrl(objectMapper, raw, null);
        return u.isEmpty() ? null : u;
    }

    private static String asString(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
