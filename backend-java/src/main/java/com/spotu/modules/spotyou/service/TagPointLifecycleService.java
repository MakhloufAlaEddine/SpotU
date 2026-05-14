package com.spotu.modules.spotyou.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.error.ApiConflictException;
import com.spotu.error.ApiForbiddenException;
import com.spotu.error.ApiNotFoundException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.auth.support.PythonIsoTimestamps;
import com.spotu.modules.spotyou.dto.DeleteTagPointResponse;
import com.spotu.modules.spotyou.dto.ReactivateTagPointResponse;
import com.spotu.modules.spotyou.infra.TagPointLifecycleRepository;
import com.spotu.modules.spotyou.support.TagPointResponseBuilder;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

@Service
public class TagPointLifecycleService {

    private static final Logger log = LoggerFactory.getLogger(TagPointLifecycleService.class);
    private static final String SPOT_FALLBACK = "SpotYou";

    private final TagPointLifecycleRepository lifecycleRepository;
    private final AuthMeService authMeService;
    private final SpotYouPushSideEffectService pushSideEffectService;
    private final ObjectMapper objectMapper;

    public TagPointLifecycleService(
            TagPointLifecycleRepository lifecycleRepository,
            AuthMeService authMeService,
            SpotYouPushSideEffectService pushSideEffectService,
            ObjectMapper objectMapper
    ) {
        this.lifecycleRepository = lifecycleRepository;
        this.authMeService = authMeService;
        this.pushSideEffectService = pushSideEffectService;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public DeleteTagPointResponse softDelete(HttpServletRequest request, String pointId) {
        CurrentUserDto caller = authMeService.requireCurrentUser(request);
        boolean isAdmin = "admin".equals(caller.role());
        Timestamp now = Timestamp.from(Instant.now());
        Timestamp mediaPurgeAt = Timestamp.from(now.toInstant().plus(90, ChronoUnit.DAYS));

        Map<String, Object> tp = lifecycleRepository.findDeleteGuardRow(pointId)
                .orElseThrow(() -> new ApiNotFoundException("SpotYou introuvable"));
        if (tp.get("deleted_at") != null) {
            throw new ApiConflictException("Ce SpotYou est déjà supprimé");
        }
        String ownerId = String.valueOf(tp.get("user_id"));
        if (!ownerId.equals(caller.userId()) && !isAdmin) {
            throw new ApiForbiddenException("Non autorisé");
        }

        lifecycleRepository.softDeleteTagPoint(pointId, caller.userId(), now, mediaPurgeAt);
        int convs = lifecycleRepository.markConversationsContextDeleted(List.of(pointId));
        int queued = lifecycleRepository.scheduleFileDeletions(
                "tag_point",
                pointId,
                parseImages(tp.get("images")),
                mediaPurgeAt
        );
        List<String> members = lifecycleRepository.findMemberUserIdsExcluding(pointId, ownerId);

        String titleStr = tp.get("title") == null || String.valueOf(tp.get("title")).isBlank()
                ? SPOT_FALLBACK : String.valueOf(tp.get("title"));
        String firstImage = TagPointResponseBuilder.firstImage(objectMapper, tp.get("images"), tp.get("image_url"));
        registerAfterCommit(() -> {
            for (String uid : members) {
                pushSideEffectService.fireAndForget(
                        uid,
                        "spotyu_deactivated",
                        "SpotYou désactivé",
                        "\"" + titleStr + "\" a été désactivé. Vous pouvez encore quitter cette communauté depuis votre onglet Communautés.",
                        Map.of(
                                "type", "spotyu_deactivated",
                                "point_id", pointId,
                                "sender_id", caller.userId(),
                                "sender_name", caller.name() == null ? "" : caller.name(),
                                "sender_picture", caller.picture() == null ? "" : caller.picture(),
                                "action_text", "a désactivé le SpotYou",
                                "content_title", titleStr,
                                "image_url", firstImage
                        )
                );
            }
        });

        log.info("[SOFTDEL] SpotYou {} supprimé par {} (médias dans {}j, membres notifiés: {})",
                pointId, caller.userId(), 90, members.size());

        return new DeleteTagPointResponse(
                true,
                true,
                pointId,
                convs,
                queued,
                members.size(),
                PythonIsoTimestamps.fromTimestamp(mediaPurgeAt)
        );
    }

    @Transactional
    public ReactivateTagPointResponse reactivate(HttpServletRequest request, String pointId) {
        CurrentUserDto caller = authMeService.requireCurrentUser(request);
        boolean isAdmin = "admin".equals(caller.role());
        Timestamp now = Timestamp.from(Instant.now());

        Map<String, Object> tp = lifecycleRepository.findReactivateGuardRow(pointId)
                .orElseThrow(() -> new ApiNotFoundException("SpotYou introuvable"));
        boolean active = Boolean.TRUE.equals(tp.get("active"));
        if (active && tp.get("deleted_at") == null) {
            throw new ApiConflictException("Ce SpotYou est déjà actif");
        }
        String ownerId = String.valueOf(tp.get("user_id"));
        if (!ownerId.equals(caller.userId()) && !isAdmin) {
            throw new ApiForbiddenException("Non autorisé");
        }

        int cancelled = lifecycleRepository.cancelPendingFileDeletions(pointId);
        lifecycleRepository.reactivateTagPoint(pointId, now);
        lifecycleRepository.unmarkConversationContextDeleted(pointId);
        List<String> members = lifecycleRepository.findMemberUserIdsExcluding(pointId, caller.userId());

        String titleRaw = tp.get("title") == null || String.valueOf(tp.get("title")).isBlank()
                ? SPOT_FALLBACK : String.valueOf(tp.get("title"));
        String titleStr = titleRaw.length() > 50 ? titleRaw.substring(0, 50) : titleRaw;
        registerAfterCommit(() -> {
            for (String uid : members) {
                pushSideEffectService.fireAndForget(
                        uid,
                        "spotyu_reactivated",
                        "SpotYou réactivé 🎉",
                        "«" + titleStr + "» est de retour ! Rejoignez les prochaines séances.",
                        Map.of(
                                "type", "spotyu_reactivated",
                                "point_id", pointId
                        )
                );
            }
        });

        boolean mediaPurged = Boolean.TRUE.equals(tp.get("media_purged"));
        log.info("[REACTIVATE] SpotYou {} réactivé par {} (médias_purgés={}, membres notifiés: {})",
                pointId, caller.userId(), mediaPurged, members.size());

        return new ReactivateTagPointResponse(
                true,
                true,
                pointId,
                mediaPurged,
                mediaPurged,
                cancelled
        );
    }

    private List<String> parseImages(Object raw) {
        if (raw == null) {
            return List.of();
        }
        if (raw instanceof String s) {
            if (s.isBlank()) {
                return List.of();
            }
            try {
                return objectMapper.readValue(s, new TypeReference<List<String>>() {
                });
            } catch (Exception e) {
                return List.of();
            }
        }
        if (raw instanceof List<?> l) {
            return l.stream().filter(v -> v != null && !String.valueOf(v).isBlank()).map(String::valueOf).toList();
        }
        return List.of();
    }

    private static void registerAfterCommit(Runnable runnable) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    runnable.run();
                }
            });
        } else {
            runnable.run();
        }
    }
}

