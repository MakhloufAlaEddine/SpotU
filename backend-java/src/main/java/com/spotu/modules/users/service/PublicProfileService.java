package com.spotu.modules.users.service;

import com.spotu.error.ApiNotFoundException;
import com.spotu.modules.users.dto.PublicProfileDto;
import com.spotu.modules.users.dto.TagPointPublicDto;
import com.spotu.modules.users.infra.PublicProfileRepository;
import com.spotu.modules.users.util.NextSessionDateCalculator;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Collections;
import java.util.List;
import java.util.Map;

@Service
public class PublicProfileService {

    private final PublicProfileRepository repository;
    private final NextSessionDateCalculator nextSessionDateCalculator;
    private final OptionalAuthResolver optionalAuthResolver;

    public PublicProfileService(
            PublicProfileRepository repository,
            NextSessionDateCalculator nextSessionDateCalculator,
            OptionalAuthResolver optionalAuthResolver
    ) {
        this.repository = repository;
        this.nextSessionDateCalculator = nextSessionDateCalculator;
        this.optionalAuthResolver = optionalAuthResolver;
    }

    public PublicProfileDto getPublicProfile(String userId, HttpServletRequest request) {
        String meId = optionalAuthResolver.resolveMeIdOrNull(request);

        PublicProfileRepository.PublicUserRow user = repository.findPublicUserById(userId)
                .orElseThrow(() -> new ApiNotFoundException("User not found"));

        PublicProfileDto dto = new PublicProfileDto();
        dto.setUserId(user.userId());
        dto.setName(user.name());
        dto.setPicture(user.picture());
        dto.setCoverPicture(user.coverPicture());
        dto.setCoverOffsetY(user.coverOffsetY());
        dto.setCoverScale(user.coverScale());
        dto.setRole(user.role());
        dto.setBio(user.bio());
        dto.setIsCoachVerified(user.isCoachVerified());
        dto.setCoachTags(user.coachTags());
        dto.setShowPhone(user.showPhone());
        dto.setShowReviews(user.showReviews());
        dto.setPhone(user.showPhone() ? user.phone() : null);

        dto.setFollowersCount(repository.countFollowers(userId));
        dto.setFollowingCount(repository.countFollowing(userId));
        if (meId != null && !meId.equals(userId)) {
            dto.setFollowing(repository.isFollowing(meId, userId));
        } else {
            dto.setFollowing(false);
        }

        if (user.coachTags().isEmpty()) {
            dto.setInterests(Collections.emptyList());
        } else {
            dto.setInterests(repository.findInterestsByTagIds(user.coachTags()));
        }

        if (user.showReviews()) {
            List<BigDecimal> ratings = repository.findReviewRatings(userId);
            dto.setReviewCount(ratings.size());
            dto.setAvgRating(computePythonRoundedAverage(ratings));
        } else {
            dto.setAvgRating(null);
            dto.setReviewCount(0);
        }

        if ("coach".equals(user.role())) {
            dto.setServices(repository.findActiveServicesByCoachId(userId));
        } else {
            dto.setServices(null);
        }

        List<TagPointPublicDto> tagPoints = repository.findActiveTagPointsByUserId(userId);
        enrichTagPoints(tagPoints);
        dto.setTagPoints(tagPoints);

        return dto;
    }

    private void enrichTagPoints(List<TagPointPublicDto> tagPoints) {
        if (tagPoints.isEmpty()) {
            return;
        }
        List<String> pointIds = tagPoints.stream().map(TagPointPublicDto::getPointId).toList();
        Map<String, Integer> participantsMap = repository.batchParticipantsCount(pointIds);
        Map<String, Integer> goingMap = repository.batchGoingCount(pointIds);
        Map<String, PublicProfileRepository.VoteStats> voteStats = repository.batchVoteStats(pointIds);

        for (TagPointPublicDto tp : tagPoints) {
            int participants = participantsMap.getOrDefault(tp.getPointId(), 0);
            int going = goingMap.getOrDefault(tp.getPointId(), 0);
            PublicProfileRepository.VoteStats vs = voteStats.get(tp.getPointId());

            tp.setParticipantsCount(participants);
            tp.setGoingCount(going);
            tp.setRating(vs == null ? 0.0 : vs.rating());
            tp.setVoteCount(vs == null ? 0 : vs.voteCount());

            var nextDate = nextSessionDateCalculator.compute(tp);
            tp.setNextSessionDate(nextDate == null ? null : nextDate.toString());

            Integer max = tp.getMaximumParticipants();
            tp.setFull(max != null && going >= max);
        }
    }

    private static Double computePythonRoundedAverage(List<BigDecimal> ratings) {
        if (ratings.isEmpty()) {
            return null;
        }
        BigDecimal sum = ratings.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal avg = sum.divide(BigDecimal.valueOf(ratings.size()), 10, RoundingMode.HALF_UP);
        return avg.setScale(1, RoundingMode.HALF_EVEN).doubleValue();
    }
}
