package com.spotu.modules.users.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.error.ApiBadRequestException;
import com.spotu.error.ApiForbiddenException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.infra.UserMeRepository;
import com.spotu.modules.uploads.service.FileStorageService;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

@Service
public class UserProfileWriteService {

    private static final Set<String> CLEARABLE_FIELDS = Set.of("iban", "bic", "iban_name", "bio", "phone", "picture");
    private static final Set<String> JSON_FIELDS = Set.of("coach_tags", "goals", "user_roles");
    private static final Set<String> ALLOWED_FIELDS = Set.of(
            "name", "bio", "phone", "language", "picture",
            "coach_tags", "show_phone", "show_reviews",
            "iban", "bic", "iban_name",
            "sports_level", "goals", "user_roles", "onboarding_done"
    );

    private final UserProfileWriteRepository repository;
    private final UserMeRepository userMeRepository;
    private final FileStorageService fileStorageService;
    private final ObjectMapper objectMapper;

    public UserProfileWriteService(
            UserProfileWriteRepository repository,
            UserMeRepository userMeRepository,
            FileStorageService fileStorageService,
            ObjectMapper objectMapper
    ) {
        this.repository = repository;
        this.userMeRepository = userMeRepository;
        this.fileStorageService = fileStorageService;
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> updateProfile(CurrentUserDto user, Map<String, Object> body) {
        Map<String, Object> updateFields = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : body.entrySet()) {
            String key = entry.getKey();
            if (!ALLOWED_FIELDS.contains(key)) {
                continue;
            }
            Object value = entry.getValue();
            if (value != null) {
                if ("language".equals(key)) {
                    String lang = String.valueOf(value);
                    if (!"fr".equals(lang) && !"en".equals(lang)) {
                        throw new ApiBadRequestException("Input should be 'fr' or 'en'");
                    }
                }
                if (JSON_FIELDS.contains(key) && value instanceof java.util.List<?>) {
                    try {
                        updateFields.put(key, objectMapper.writeValueAsString(value));
                    } catch (Exception e) {
                        throw new ApiBadRequestException("Payload invalide");
                    }
                } else {
                    updateFields.put(key, value);
                }
            } else if (CLEARABLE_FIELDS.contains(key)) {
                updateFields.put(key, null);
            }
        }

        if (updateFields.containsKey("name")) {
            Object n = updateFields.get("name");
            if (n == null || String.valueOf(n).trim().isEmpty()) {
                throw new ApiBadRequestException("Le nom est obligatoire");
            }
            updateFields.put("name", String.valueOf(n).trim());
        }

        Map<String, Object> current = userMeRepository.findUserMapByUserId(user.userId())
                .orElseThrow(() -> new com.spotu.error.ApiAuthException("User not found"));

        if (updateFields.isEmpty()) {
            return current;
        }

        if (updateFields.containsKey("picture")) {
            String oldPicture = current.get("picture") == null ? null : String.valueOf(current.get("picture"));
            Object newPictureObj = updateFields.get("picture");
            String newPicture = newPictureObj == null ? null : String.valueOf(newPictureObj);
            if (oldPicture != null && !oldPicture.equals(newPicture)) {
                fileStorageService.deleteUploadFile(oldPicture);
            }
        }

        repository.updateProfileDynamic(user.userId(), updateFields);
        return userMeRepository.findUserMapByUserId(user.userId())
                .orElseThrow(() -> new com.spotu.error.ApiAuthException("User not found"));
    }

    public Map<String, Object> becomeCoach(CurrentUserDto user) {
        if ("coach".equals(user.role()) || "admin".equals(user.role())) {
            throw new ApiBadRequestException("Already a coach or admin");
        }
        repository.becomeCoach(user.userId());
        return userMeRepository.findUserMapByUserId(user.userId())
                .orElseThrow(() -> new com.spotu.error.ApiAuthException("User not found"));
    }

    public Map<String, Object> updateCover(
            CurrentUserDto me,
            String targetUserId,
            String coverPicture,
            Object coverOffsetY,
            Object coverScale
    ) {
        if (!me.userId().equals(targetUserId)) {
            throw new ApiForbiddenException("Accès refusé.");
        }
        String oldCover = repository.findCoverPicture(targetUserId).orElse(null);

        String coverUrl = (coverPicture == null || coverPicture.isBlank()) ? null : coverPicture;
        if (coverOffsetY != null || coverScale != null) {
            double offset = coverOffsetY == null ? 0.5 : toDouble(coverOffsetY);
            double scale = coverScale == null ? 1.0 : toDouble(coverScale);
            repository.updateCoverWithTransform(targetUserId, coverUrl, offset, scale);
        } else {
            repository.updateCoverOnly(targetUserId, coverUrl);
        }

        if (oldCover != null && !oldCover.equals(coverUrl)) {
            fileStorageService.deleteUploadFile(oldCover);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("cover_picture", coverUrl);
        out.put("cover_offset_y", coverOffsetY);
        out.put("cover_scale", coverScale);
        return out;
    }

    private static double toDouble(Object v) {
        if (v instanceof Number n) {
            return n.doubleValue();
        }
        return Double.parseDouble(String.valueOf(v));
    }
}

