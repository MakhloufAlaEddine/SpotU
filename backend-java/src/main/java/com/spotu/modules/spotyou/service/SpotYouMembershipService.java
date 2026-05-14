package com.spotu.modules.spotyou.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.error.ApiBadRequestException;
import com.spotu.error.ApiConflictException;
import com.spotu.error.ApiForbiddenException;
import com.spotu.error.ApiNotFoundException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.auth.support.PythonIsoTimestamps;
import com.spotu.modules.spotyou.infra.SpotYouMembershipRepository;
import com.spotu.modules.spotyou.infra.TagPointReadRepository;
import com.spotu.modules.spotyou.support.EmergentIds;
import com.spotu.modules.spotyou.support.TagPointResponseBuilder;
import com.spotu.modules.chat.service.SpotYouWsBridge;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class SpotYouMembershipService {

    private final SpotYouMembershipRepository membershipRepository;
    private final TagPointReadRepository tagPointReadRepository;
    private final AuthMeService authMeService;
    private final SpotYouPushSideEffectService pushSideEffectService;
    private final SpotYouWsBridge spotYouWsBridge;
    private final ObjectMapper objectMapper;

    public SpotYouMembershipService(
            SpotYouMembershipRepository membershipRepository,
            TagPointReadRepository tagPointReadRepository,
            AuthMeService authMeService,
            SpotYouPushSideEffectService pushSideEffectService,
            SpotYouWsBridge spotYouWsBridge,
            ObjectMapper objectMapper
    ) {
        this.membershipRepository = membershipRepository;
        this.tagPointReadRepository = tagPointReadRepository;
        this.authMeService = authMeService;
        this.pushSideEffectService = pushSideEffectService;
        this.spotYouWsBridge = spotYouWsBridge;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public Map<String, Object> save(HttpServletRequest request, String pointId) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        Boolean active = membershipRepository.findActiveByPointId(pointId)
                .orElseThrow(() -> new ApiNotFoundException("SpotYou non disponible"));
        if (!active) {
            throw new ApiNotFoundException("SpotYou non disponible");
        }
        membershipRepository.insertSave(EmergentIds.newId("save"), pointId, user.userId());
        return Map.of("success", true, "is_saved", true);
    }

    @Transactional
    public Map<String, Object> unsave(HttpServletRequest request, String pointId) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        membershipRepository.deleteSave(pointId, user.userId());
        return Map.of("success", true, "is_saved", false);
    }

    @Transactional
    public Map<String, Object> join(HttpServletRequest request, String pointId) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        String uid = user.userId();
        Map<String, Object> tp = membershipRepository.findTagPointForJoin(pointId)
                .orElseThrow(() -> new ApiNotFoundException("SpotYou non disponible"));
        String ownerId = String.valueOf(tp.get("user_id"));
        if (ownerId.equals(uid)) {
            throw new ApiBadRequestException("Vous êtes déjà le créateur de ce SpotYou.");
        }
        Optional<String> existing = membershipRepository.findMembershipStatus(pointId, uid);
        if (existing.isPresent()) {
            String st = existing.get();
            if ("accepted".equals(st)) {
                int cnt = membershipRepository.countAcceptedMembers(pointId);
                return Map.of(
                        "success", true,
                        "status", "accepted",
                        "participants_count", cnt,
                        "is_participant", true
                );
            }
            if ("pending".equals(st)) {
                return Map.of(
                        "success", true,
                        "status", "pending",
                        "is_participant", false,
                        "message", "Votre demande est déjà en attente de validation."
                );
            }
            if ("invited".equals(st)) {
                return Map.of(
                        "success", true,
                        "status", "invited",
                        "is_participant", false,
                        "message", "Vous avez une invitation en attente. Acceptez-la depuis vos notifications."
                );
            }
        }

        String visibility = tp.get("visibility_type") == null ? "public" : String.valueOf(tp.get("visibility_type"));
        String joinMode = tp.get("join_mode") == null ? "open" : String.valueOf(tp.get("join_mode"));
        if ("private".equals(visibility)) {
            throw new ApiForbiddenException("Ce SpotYou est privé. L'accès se fait uniquement sur invitation.");
        }

        Object maxObj = tp.get("max_community_members");
        if (maxObj instanceof Number maxN && maxN.intValue() > 0) {
            int current = membershipRepository.countAcceptedMembers(pointId);
            if (current >= maxN.intValue()) {
                throw new ApiConflictException("Cette communauté a atteint sa capacité maximale.");
            }
        }

        String title = tp.get("title") == null ? "SpotYou" : String.valueOf(tp.get("title"));
        boolean needsApproval = "admin_approval".equals(joinMode) || "members_approval".equals(joinMode);

        if (needsApproval) {
            membershipRepository.upsertMembership(
                    EmergentIds.newId("part"), pointId, uid, "pending", uid
            );
            Map<String, Object> senderInfo = joinRequestData(pointId, uid, user, title, tp.get("images"), tp.get("image_url"));
            if ("admin_approval".equals(joinMode)) {
                Map<String, Object> data = new LinkedHashMap<>(senderInfo);
                data.put("recipient_is_owner", true);
                pushSideEffectService.fireAndForget(
                        ownerId,
                        "join_request",
                        "Nouvelle demande d'adhésion",
                        user.name() + " souhaite rejoindre «" + title + "»",
                        data
                );
            } else {
                List<String> recipients = membershipRepository.findAcceptedMemberUserIdsExcept(pointId, uid);
                for (String rid : recipients) {
                    Map<String, Object> data = new LinkedHashMap<>(senderInfo);
                    data.put("recipient_is_admin", ownerId.equals(rid));
                    pushSideEffectService.fireAndForget(
                            rid,
                            "join_request",
                            "Nouvelle demande d'adhésion",
                            user.name() + " souhaite rejoindre «" + title + "»",
                            data
                    );
                }
            }
            return Map.of(
                    "success", true,
                    "status", "pending",
                    "is_participant", false,
                    "message", "Votre demande a été envoyée. En attente de validation."
            );
        }

        membershipRepository.upsertMembership(
                EmergentIds.newId("part"), pointId, uid, "accepted", uid
        );
        int count = membershipRepository.countAcceptedMembers(pointId);
        spotYouWsBridge.broadcast(pointId, Map.of(
                "type", "spotyou_update",
                "point_id", pointId,
                "participants_count", count
        ));
        if (!ownerId.equals(uid)) {
            pushSideEffectService.fireAndForget(
                    ownerId,
                    "spotyu_join",
                    "Nouveau membre",
                    user.name() + " a rejoint votre SpotYou «" + title + "»",
                    Map.of(
                            "type", "spotyu_join",
                            "point_id", pointId,
                            "sender_id", uid,
                            "sender_name", user.name() == null ? "" : user.name(),
                            "sender_picture", user.picture() == null ? "" : user.picture(),
                            "action_text", "a rejoint votre SpotYou",
                            "content_title", title,
                            "image_url", TagPointResponseBuilder.firstImage(objectMapper, tp.get("images"), tp.get("image_url"))
                    )
            );
        }
        return Map.of("success", true, "status", "accepted", "participants_count", count, "is_participant", true);
    }

    private Map<String, Object> joinRequestData(String pointId, String uid, CurrentUserDto user, String title, Object images, Object imageUrl) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("type", "join_request");
        m.put("point_id", pointId);
        m.put("sender_id", uid);
        m.put("sender_name", user.name() == null ? "" : user.name());
        m.put("sender_picture", user.picture() == null ? "" : user.picture());
        m.put("action_text", "souhaite rejoindre votre SpotYou");
        m.put("content_title", title);
        m.put("image_url", TagPointResponseBuilder.firstImage(objectMapper, images, imageUrl));
        return m;
    }

    /**
     * Python : {@code invite_permissions or "admin_only"}. La valeur legacy {@code members} du schéma H2 est traitée comme {@code admin_and_members}.
     */
    private static String normalizeInvitePermissions(Object raw) {
        if (raw == null) {
            return "admin_only";
        }
        String s = String.valueOf(raw).trim();
        if (s.isEmpty()) {
            return "admin_only";
        }
        if ("members".equals(s)) {
            return "admin_and_members";
        }
        return s;
    }

    @Transactional
    public Map<String, Object> cancelRequest(HttpServletRequest request, String pointId) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        Optional<String> st = membershipRepository.findMembershipStatus(pointId, user.userId());
        if (st.isEmpty()) {
            throw new ApiNotFoundException("Aucune demande trouvée pour ce SpotYou");
        }
        if (!"pending".equals(st.get())) {
            throw new ApiBadRequestException("Impossible d'annuler une demande déjà traitée");
        }
        membershipRepository.deleteMembershipPending(pointId, user.userId());
        return Map.of("success", true, "message", "Demande annulée");
    }

    @Transactional
    public Map<String, Object> leave(HttpServletRequest request, String pointId) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        Map<String, Object> tp = membershipRepository.findTagPointForLeave(pointId)
                .orElseThrow(() -> new ApiNotFoundException("SpotYou introuvable"));
        membershipRepository.deleteMembershipAny(pointId, user.userId());
        int count = membershipRepository.countAcceptedMembers(pointId);
        spotYouWsBridge.broadcast(pointId, Map.of(
                "type", "spotyou_update",
                "point_id", pointId,
                "participants_count", count
        ));
        String ownerId = String.valueOf(tp.get("user_id"));
        if (!ownerId.equals(user.userId())) {
            String title = tp.get("title") == null ? "SpotYou" : String.valueOf(tp.get("title"));
            pushSideEffectService.fireAndForget(
                    ownerId,
                    "spotyu_leave",
                    "Participant retiré",
                    user.name() + " a quitté votre SpotYou «" + title + "»",
                    Map.of(
                            "type", "spotyu_leave",
                            "point_id", pointId,
                            "sender_id", user.userId(),
                            "sender_name", user.name() == null ? "" : user.name(),
                            "sender_picture", user.picture() == null ? "" : user.picture(),
                            "action_text", "a quitté votre SpotYou",
                            "content_title", title,
                            "image_url", TagPointResponseBuilder.firstImage(objectMapper, tp.get("images"), tp.get("image_url"))
                    )
            );
        }
        return Map.of("success", true, "participants_count", count, "is_participant", false);
    }

    @Transactional
    public Map<String, Object> invite(HttpServletRequest request, String pointId, String invitedUserId) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        if (invitedUserId == null || invitedUserId.isBlank()) {
            throw new ApiBadRequestException("invited_user_id requis");
        }
        if (invitedUserId.equals(user.userId())) {
            throw new ApiBadRequestException("Vous ne pouvez pas vous inviter vous-même");
        }
        Map<String, Object> tp = membershipRepository.findTagPointForInvite(pointId)
                .orElseThrow(() -> new ApiNotFoundException("SpotYou introuvable ou désactivé"));
        String ownerId = String.valueOf(tp.get("user_id"));
        String invitePerms = normalizeInvitePermissions(tp.get("invite_permissions"));
        boolean isOwner = ownerId.equals(user.userId());
        if (!isOwner) {
            if ("admin_only".equals(invitePerms)) {
                throw new ApiForbiddenException("Seul l'admin peut inviter dans ce SpotYou");
            }
            if (!membershipRepository.existsAcceptedMember(pointId, user.userId())) {
                throw new ApiForbiddenException("Seuls les membres acceptés peuvent inviter");
            }
        }
        membershipRepository.findUserName(invitedUserId)
                .orElseThrow(() -> new ApiNotFoundException("Utilisateur introuvable"));
        Optional<String> existing = membershipRepository.findMembershipStatus(pointId, invitedUserId);
        if (existing.isPresent()) {
            String es = existing.get();
            if ("accepted".equals(es)) {
                throw new ApiConflictException("Cet utilisateur est déjà membre de ce SpotYou");
            }
            if ("pending".equals(es)) {
                throw new ApiConflictException("Cet utilisateur a déjà une demande en attente");
            }
            if ("invited".equals(es)) {
                throw new ApiConflictException("Cet utilisateur a déjà une invitation en attente");
            }
            if ("rejected".equals(es)) {
                membershipRepository.reinviteAfterRejected(user.userId(), pointId, invitedUserId);
            }
        } else {
            membershipRepository.insertInvitation(EmergentIds.newId("inv"), pointId, invitedUserId, user.userId());
        }
        String spotTitle = tp.get("title") == null ? "un SpotYou" : String.valueOf(tp.get("title"));
        String firstImage = TagPointResponseBuilder.firstImage(objectMapper, tp.get("images"), tp.get("image_url"));
        pushSideEffectService.fireAndForget(
                invitedUserId,
                "spotyou_invitation",
                "Invitation SpotYou",
                "Tu as été invité à rejoindre « " + spotTitle + " »",
                Map.of(
                        "type", "spotyou_invitation",
                        "point_id", pointId,
                        "sender_id", user.userId(),
                        "sender_name", user.name() == null ? "" : user.name(),
                        "sender_picture", user.picture() == null ? "" : user.picture(),
                        "action_text", "t'a invité à rejoindre",
                        "content_title", spotTitle,
                        "image_url", firstImage
                )
        );
        String targetName = membershipRepository.findUserName(invitedUserId).orElse("");
        return Map.of("success", true, "message", "Invitation envoyée à " + targetName);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> myInvitations(HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        List<Map<String, Object>> rows = tagPointReadRepository.findSpotYouInvitationsForUser(user.userId());
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> copy = new LinkedHashMap<>(row);
            Object invitedAt = copy.remove("invited_at");
            Object invitedById = copy.remove("invited_by");
            Object inviterName = copy.remove("inviter_name");
            Object inviterPicture = copy.remove("inviter_picture");
            Map<String, Object> pt = TagPointResponseBuilder.buildPointResponse(copy, false, objectMapper);
            pt.put("join_status", "invited");
            pt.put("invited_at", invitedAt instanceof Timestamp ts ? PythonIsoTimestamps.fromTimestamp(ts) : (invitedAt == null ? null : String.valueOf(invitedAt)));
            if (invitedById != null) {
                Map<String, Object> inviter = new LinkedHashMap<>();
                inviter.put("user_id", String.valueOf(invitedById));
                inviter.put("name", inviterName);
                inviter.put("picture", inviterPicture);
                pt.put("inviter", inviter);
            } else {
                pt.put("inviter", null);
            }
            out.add(pt);
        }
        return out;
    }

    @Transactional
    public Map<String, Object> acceptInvitation(HttpServletRequest request, String pointId) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        Map<String, Object> inv = membershipRepository.findInvitationRow(pointId, user.userId())
                .orElseThrow(() -> new ApiNotFoundException("Invitation introuvable"));
        if (!"invited".equals(inv.get("status"))) {
            throw new ApiConflictException("Statut actuel : " + inv.get("status"));
        }
        String inviterId = inv.get("invited_by") == null ? null : String.valueOf(inv.get("invited_by"));
        membershipRepository.acceptInvitation(pointId, user.userId());
        int count = membershipRepository.countAcceptedMembers(pointId);
        String title = membershipRepository.findTagPointTitle(pointId).orElse("SpotYou");
        if (inviterId != null && !inviterId.isBlank()) {
            pushSideEffectService.fireAndForget(
                    inviterId,
                    "spotyou_invite_accepted",
                    "Invitation acceptée",
                    (user.name() == null ? "Un utilisateur" : user.name()) + " a rejoint « " + title + " »",
                    Map.of(
                            "type", "spotyou_invite_accepted",
                            "point_id", pointId,
                            "sender_id", user.userId(),
                            "sender_name", user.name() == null ? "" : user.name(),
                            "sender_picture", user.picture() == null ? "" : user.picture(),
                            "action_text", "a rejoint le SpotYou",
                            "content_title", title
                    )
            );
        }
        return Map.of("success", true, "status", "accepted", "participants_count", count);
    }

    @Transactional
    public Map<String, Object> refuseInvitation(HttpServletRequest request, String pointId) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        Map<String, Object> inv = membershipRepository.findInvitationRow(pointId, user.userId())
                .orElseThrow(() -> new ApiNotFoundException("Invitation introuvable"));
        if (!"invited".equals(inv.get("status"))) {
            throw new ApiConflictException("Statut actuel : " + inv.get("status"));
        }
        String inviterId = inv.get("invited_by") == null ? null : String.valueOf(inv.get("invited_by"));
        membershipRepository.refuseInvitation(pointId, user.userId());
        String title = membershipRepository.findTagPointTitle(pointId).orElse("SpotYou");
        if (inviterId != null && !inviterId.isBlank()) {
            pushSideEffectService.fireAndForget(
                    inviterId,
                    "spotyou_invite_refused",
                    "Invitation refusée",
                    (user.name() == null ? "Un utilisateur" : user.name()) + " a refusé l'invitation à « " + title + " »",
                    Map.of(
                            "type", "spotyou_invite_refused",
                            "point_id", pointId,
                            "sender_id", user.userId(),
                            "sender_name", user.name() == null ? "" : user.name(),
                            "content_title", title
                    )
            );
        }
        return Map.of("success", true, "status", "rejected");
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> joinRequests(HttpServletRequest request, String pointId) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        Map<String, Object> tp = membershipRepository.findTagPointForJoinRequests(pointId)
                .orElseThrow(() -> new ApiNotFoundException("SpotYou introuvable"));
        String ownerId = String.valueOf(tp.get("user_id"));
        String joinMode = tp.get("join_mode") == null ? "open" : String.valueOf(tp.get("join_mode"));
        boolean isOwner = ownerId.equals(user.userId());
        boolean isMember = membershipRepository.existsAcceptedMember(pointId, user.userId());
        if (!isOwner && !(isMember && "members_approval".equals(joinMode))) {
            throw new ApiForbiddenException("Accès refusé");
        }
        List<Map<String, Object>> rows = membershipRepository.listJoinRequests(pointId);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("user_id", r.get("user_id"));
            m.put("name", r.get("name"));
            m.put("picture", r.get("picture"));
            m.put("role", r.get("role"));
            Object ja = r.get("joined_at");
            String iso = null;
            if (ja instanceof Timestamp ts) {
                iso = PythonIsoTimestamps.fromTimestamp(ts);
            } else if (ja != null) {
                iso = String.valueOf(ja);
            }
            m.put("requested_at", iso);
            out.add(m);
        }
        return out;
    }

    @Transactional
    public Map<String, Object> approve(HttpServletRequest request, String pointId, String memberId) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        Map<String, Object> tp = membershipRepository.findTagPointForApprove(pointId)
                .orElseThrow(() -> new ApiNotFoundException("SpotYou introuvable"));
        String ownerId = String.valueOf(tp.get("user_id"));
        String joinMode = tp.get("join_mode") == null ? "open" : String.valueOf(tp.get("join_mode"));
        boolean isOwner = ownerId.equals(user.userId());
        boolean isMember = membershipRepository.existsAcceptedMember(pointId, user.userId());
        if ("admin_approval".equals(joinMode) && !isOwner) {
            throw new ApiForbiddenException("Seul l'admin peut approuver cette demande.");
        }
        if ("members_approval".equals(joinMode) && !isOwner && !isMember) {
            throw new ApiForbiddenException("Seul un membre peut approuver cette demande.");
        }
        Map<String, Object> pending = membershipRepository.findMemberRow(pointId, memberId)
                .orElseThrow(() -> new ApiNotFoundException("Aucune demande trouvée pour cet utilisateur."));
        String pst = String.valueOf(pending.get("status"));
        if (!"pending".equals(pst)) {
            if ("accepted".equals(pst)) {
                throw new ApiConflictException("Cette demande a déjà été acceptée par un autre membre.");
            }
            throw new ApiConflictException("Cette demande a déjà été traitée.");
        }
        int n = membershipRepository.approveMember(user.userId(), pointId, memberId);
        if (n == 0) {
            throw new ApiNotFoundException("Aucune demande trouvée pour cet utilisateur.");
        }
        int count = membershipRepository.countAcceptedMembers(pointId);
        String title = tp.get("title") == null ? "SpotYou" : String.valueOf(tp.get("title"));
        pushSideEffectService.fireAndForget(
                memberId,
                "join_approved",
                "Demande acceptée !",
                "Vous êtes maintenant membre de «" + title + "».",
                Map.of(
                        "type", "join_approved",
                        "point_id", pointId,
                        "content_title", title,
                        "image_url", TagPointResponseBuilder.firstImage(objectMapper, tp.get("images"), tp.get("image_url"))
                )
        );
        return Map.of("success", true, "participants_count", count);
    }

    @Transactional
    public Map<String, Object> reject(HttpServletRequest request, String pointId, String memberId) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        Map<String, Object> tp = membershipRepository.findTagPointForReject(pointId)
                .orElseThrow(() -> new ApiNotFoundException("SpotYou introuvable"));
        String ownerId = String.valueOf(tp.get("user_id"));
        boolean platformAdmin = "admin".equals(user.role());
        if (!ownerId.equals(user.userId()) && !platformAdmin) {
            throw new ApiForbiddenException("Seul l'admin peut refuser une demande.");
        }
        Map<String, Object> current = membershipRepository.findMemberRow(pointId, memberId)
                .orElseThrow(() -> new ApiNotFoundException("Aucune demande trouvée pour cet utilisateur."));
        String cst = String.valueOf(current.get("status"));
        if (!"pending".equals(cst)) {
            if ("accepted".equals(cst)) {
                throw new ApiConflictException("Cette demande a déjà été acceptée. Impossible de la refuser.");
            }
            throw new ApiConflictException("Cette demande a déjà été traitée.");
        }
        int n = membershipRepository.rejectMember(user.userId(), pointId, memberId);
        if (n == 0) {
            throw new ApiNotFoundException("Demande introuvable ou déjà traitée.");
        }
        String title = tp.get("title") == null ? "SpotYou" : String.valueOf(tp.get("title"));
        pushSideEffectService.fireAndForget(
                memberId,
                "join_rejected",
                "Demande refusée",
                "Votre demande pour rejoindre «" + title + "» n'a pas été acceptée.",
                Map.of("type", "join_rejected", "point_id", pointId, "content_title", title)
        );
        return Map.of("success", true);
    }
}
