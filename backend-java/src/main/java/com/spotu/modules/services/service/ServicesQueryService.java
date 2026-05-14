package com.spotu.modules.services.service;

import com.spotu.error.ApiNotFoundException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.infra.UserMeRepository;
import com.spotu.modules.auth.service.JwtService;
import com.spotu.modules.auth.service.TokenExtractor;
import com.spotu.modules.services.dto.CoachSummaryDto;
import com.spotu.modules.services.dto.ServiceDeactivatedDto;
import com.spotu.modules.services.dto.ServiceDetailDto;
import com.spotu.modules.services.dto.ServiceLocationDto;
import com.spotu.modules.services.dto.ServiceMineDto;
import com.spotu.modules.services.dto.ServicePackageDto;
import com.spotu.modules.services.dto.ServiceSavedDto;
import com.spotu.modules.services.dto.ServiceSearchDto;
import com.spotu.modules.services.dto.ServiceSlotDto;
import com.spotu.modules.services.dto.TagDetailDto;
import com.spotu.modules.services.infra.ServicesRepository;
import com.spotu.modules.services.util.AddressMaskUtil;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

@Service
public class ServicesQueryService {

    private final ServicesRepository repository;
    private final AddressMaskUtil addressMaskUtil;
    private final JwtService jwtService;
    private final UserMeRepository userMeRepository;

    public ServicesQueryService(
            ServicesRepository repository,
            AddressMaskUtil addressMaskUtil,
            JwtService jwtService,
            UserMeRepository userMeRepository
    ) {
        this.repository = repository;
        this.addressMaskUtil = addressMaskUtil;
        this.jwtService = jwtService;
        this.userMeRepository = userMeRepository;
    }

    public List<ServiceSearchDto> searchServices(Double lat, Double lng, Integer radius, String coachId, String domainId, HttpServletRequest request) {
        CurrentUserDto viewer = resolveOptionalViewer(request);
        String currentUserId = viewer == null ? null : viewer.userId();

        List<ServicesRepository.ServiceRow> rows = repository.searchServices(lat, lng, radius, coachId, domainId, currentUserId);
        if (rows.isEmpty()) {
            return Collections.emptyList();
        }

        List<String> serviceIds = rows.stream().map(ServicesRepository.ServiceRow::serviceId).toList();
        List<String> coachIds = rows.stream()
                .map(ServicesRepository.ServiceRow::coachId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        List<String> allTagIds = rows.stream().flatMap(r -> r.tagIds().stream()).distinct().toList();

        Map<String, CoachSummaryDto> coaches = repository.findCoachesByIds(coachIds);
        Map<String, ServicesRepository.ReviewStats> stats = repository.findReviewStatsByCoachIds(coachIds);
        Map<String, List<ServiceLocationDto>> locations = repository.findLocationsByServiceIds(serviceIds);
        Map<String, TagDetailDto> tagsById = repository.findTagsByIds(allTagIds);

        List<ServiceSearchDto> result = new ArrayList<>();
        for (ServicesRepository.ServiceRow row : rows) {
            List<ServiceLocationDto> maskedLocations = maskLocations(locations.getOrDefault(row.serviceId(), Collections.emptyList()), false);
            String maskedAddress = maskTopAddress(row.address(), maskedLocations);
            List<TagDetailDto> tags = row.tagIds().stream()
                    .filter(tagsById::containsKey)
                    .map(tagsById::get)
                    .toList();
            ServicesRepository.ReviewStats rating = stats.get(row.coachId());
            result.add(new ServiceSearchDto(
                    row.serviceId(),
                    row.coachId(),
                    row.title(),
                    row.description(),
                    maskedAddress,
                    row.price(),
                    row.durationMin(),
                    row.tagIds(),
                    row.domainId(),
                    row.locationDescription(),
                    row.maxParticipants(),
                    row.active(),
                    row.images(),
                    row.createdAt(),
                    row.updatedAt(),
                    row.bookingApprovalMode(),
                    row.allowPayLater(),
                    row.payLaterExpirationMinutes(),
                    coaches.getOrDefault(row.coachId(), new CoachSummaryDto(null, null, null, null)),
                    rating == null ? null : rating.avgRating(),
                    rating == null ? 0 : rating.reviewCount(),
                    maskedLocations,
                    tags,
                    List.of(),
                    List.of(),
                    false,
                    null
            ));
        }
        return result;
    }

    public List<ServiceMineDto> mine(HttpServletRequest request) {
        CurrentUserDto viewer = requireAuthUser(request);
        List<ServicesRepository.ServiceRow> rows = repository.findMineByCoachId(viewer.userId());
        if (rows.isEmpty()) {
            return Collections.emptyList();
        }
        List<ServiceMineDto> output = new ArrayList<>();
        for (ServicesRepository.ServiceRow row : rows) {
            ServiceDetailDto detail = buildDetailedService(row, true);
            output.add(new ServiceMineDto(
                    detail.serviceId(), detail.coachId(), detail.title(), detail.description(), detail.address(),
                    detail.price(), detail.durationMin(), detail.tagIds(), detail.domainId(), detail.locationDescription(),
                    detail.maxParticipants(), detail.active(), detail.images(), detail.createdAt(), detail.updatedAt(),
                    detail.bookingApprovalMode(), detail.allowPayLater(), detail.payLaterExpirationMinutes(),
                    detail.coach(), detail.avgRating(), detail.reviewCount(), detail.locations(), detail.tags(),
                    detail.slots(), detail.packages(), true, detail.originalAddress()
            ));
        }
        return output;
    }

    public List<ServiceSavedDto> saved(HttpServletRequest request) {
        CurrentUserDto viewer = requireAuthUser(request);
        return repository.findSavedByUserId(viewer.userId()).stream()
                .map(row -> new ServiceSavedDto(
                        row.serviceId(),
                        row.title(),
                        row.price(),
                        row.images(),
                        row.address(),
                        row.locationDescription(),
                        row.durationMin(),
                        row.savedAt(),
                        row.coach(),
                        row.latitude(),
                        row.longitude(),
                        row.availableSlots()
                ))
                .toList();
    }

    public List<ServiceDeactivatedDto> deactivated(HttpServletRequest request) {
        CurrentUserDto viewer = requireAuthUser(request);
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        return repository.findDeactivatedByCoachId(viewer.userId()).stream().map(row -> {
            Integer daysUntilMediaPurge = null;
            if (row.mediaPurgeScheduledAt() != null) {
                OffsetDateTime purgeAt = OffsetDateTime.parse(row.mediaPurgeScheduledAt());
                daysUntilMediaPurge = (int) Math.max(0, Duration.between(now, purgeAt).toDays());
            }
            ServicesRepository.ServiceRow service = row.service();
            return new ServiceDeactivatedDto(
                    service.serviceId(), service.coachId(), service.title(), service.description(), service.address(),
                    service.price(), service.durationMin(), service.tagIds(), service.domainId(), service.locationDescription(),
                    service.maxParticipants(), service.active(), service.images(), service.createdAt(), service.updatedAt(),
                    service.bookingApprovalMode(), service.allowPayLater(), service.payLaterExpirationMinutes(),
                    row.deletedAt(), row.mediaPurgeScheduledAt(), row.mediaPurged(), row.reactivatedAt(), daysUntilMediaPurge
            );
        }).toList();
    }

    public ServiceDetailDto getServiceById(String serviceId, HttpServletRequest request) {
        ServicesRepository.ServiceRow row = repository.findServiceById(serviceId)
                .orElseThrow(() -> new ApiNotFoundException("Service not found"));
        CurrentUserDto viewer = resolveOptionalViewer(request);
        boolean isOwner = viewer != null
                && (Objects.equals(viewer.userId(), row.coachId()) || Objects.equals(viewer.role(), "admin"));
        return buildDetailedService(row, isOwner);
    }

    private ServiceDetailDto buildDetailedService(ServicesRepository.ServiceRow row, boolean isOwner) {
        Map<String, CoachSummaryDto> coaches = repository.findCoachesByIds(List.of(row.coachId()));
        Map<String, ServicesRepository.ReviewStats> stats = repository.findReviewStatsByCoachIds(List.of(row.coachId()));
        Map<String, List<ServiceLocationDto>> rawLocations = repository.findLocationsByServiceIds(List.of(row.serviceId()));
        Map<String, List<ServiceSlotDto>> slotsByService = repository.findAvailableSlotsByServiceIds(List.of(row.serviceId()));
        Map<String, List<ServicePackageDto>> packagesByService = repository.findPackagesByServiceIds(List.of(row.serviceId()));
        Map<String, TagDetailDto> tagsById = repository.findTagsByIds(row.tagIds());

        List<ServiceLocationDto> locations = maskLocations(rawLocations.getOrDefault(row.serviceId(), Collections.emptyList()), isOwner);
        String originalAddress = row.address();
        String maskedAddress = maskTopAddress(row.address(), locations);
        if (!isOwner) {
            originalAddress = null;
        }

        ServicesRepository.ReviewStats rating = stats.get(row.coachId());
        List<TagDetailDto> tags = row.tagIds().stream()
                .filter(tagsById::containsKey)
                .map(tagsById::get)
                .toList();
        return new ServiceDetailDto(
                row.serviceId(),
                row.coachId(),
                row.title(),
                row.description(),
                maskedAddress,
                row.price(),
                row.durationMin(),
                row.tagIds(),
                row.domainId(),
                row.locationDescription(),
                row.maxParticipants(),
                row.active(),
                row.images(),
                row.createdAt(),
                row.updatedAt(),
                row.bookingApprovalMode(),
                row.allowPayLater(),
                row.payLaterExpirationMinutes(),
                coaches.getOrDefault(row.coachId(), new CoachSummaryDto(null, null, null, null)),
                rating == null ? null : rating.avgRating(),
                rating == null ? 0 : rating.reviewCount(),
                locations,
                tags,
                slotsByService.getOrDefault(row.serviceId(), Collections.emptyList()),
                packagesByService.getOrDefault(row.serviceId(), Collections.emptyList()),
                isOwner,
                originalAddress
        );
    }

    private CurrentUserDto requireAuthUser(HttpServletRequest request) {
        String token = TokenExtractor.fromRequest(request);
        if (token == null || token.isBlank()) {
            throw new com.spotu.error.ApiAuthException("Authentication required");
        }
        String userId = jwtService.extractUserId(token);
        return userMeRepository.findByUserId(userId)
                .orElseThrow(() -> new com.spotu.error.ApiAuthException("Authentication required"));
    }

    private List<ServiceLocationDto> maskLocations(List<ServiceLocationDto> raw, boolean isOwner) {
        List<ServiceLocationDto> out = new ArrayList<>();
        for (ServiceLocationDto location : raw) {
            String masked = addressMaskUtil.mask(location.description(), location.precision());
            String original = isOwner && !"exact".equals(location.precision()) ? location.description() : null;
            out.add(new ServiceLocationDto(
                    location.locationId(),
                    location.precision(),
                    masked,
                    location.latitude(),
                    location.longitude(),
                    original
            ));
        }
        return out;
    }

    private String maskTopAddress(String address, List<ServiceLocationDto> locations) {
        if (locations.isEmpty()) {
            return address;
        }
        String precision = locations.get(0).precision();
        if (precision == null || "exact".equals(precision)) {
            return address;
        }
        return addressMaskUtil.mask(address, precision);
    }

    private CurrentUserDto resolveOptionalViewer(HttpServletRequest request) {
        String token = TokenExtractor.fromRequest(request);
        if (token == null || token.isBlank()) {
            return null;
        }
        try {
            String userId = jwtService.extractUserId(token);
            Optional<CurrentUserDto> user = userMeRepository.findByUserId(userId);
            return user.orElse(null);
        } catch (Exception ignored) {
            return null;
        }
    }
}
