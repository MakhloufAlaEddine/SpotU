package com.spotu.modules.users.service;

import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.users.dto.UserProfileDto;
import com.spotu.modules.users.infra.BankingDetails;
import com.spotu.modules.users.infra.UserProfileRepository;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

@Service
public class UserProfileService {

    private final AuthMeService authMeService;
    private final UserProfileRepository userProfileRepository;

    public UserProfileService(AuthMeService authMeService, UserProfileRepository userProfileRepository) {
        this.authMeService = authMeService;
        this.userProfileRepository = userProfileRepository;
    }

    public UserProfileDto getMyProfile(HttpServletRequest request) {
        CurrentUserDto currentUser = authMeService.requireCurrentUser(request);

        List<BigDecimal> ratings = userProfileRepository.findRatingsByRevieweeId(currentUser.userId());
        Double avgRating = computePythonRoundedAverage(ratings);
        int reviewCount = ratings.size();

        BankingDetails banking = userProfileRepository.findBankingByUserId(currentUser.userId())
                .orElse(new BankingDetails(null, null, null));

        return UserProfileDto.fromCurrentUser(
                currentUser,
                avgRating,
                reviewCount,
                banking.iban(),
                banking.bic(),
                banking.ibanName()
        );
    }

    /**
     * Équivalent de Python round(sum(ratings)/len(ratings), 1) avec arrondi HALF_EVEN.
     */
    private static Double computePythonRoundedAverage(List<BigDecimal> ratings) {
        if (ratings.isEmpty()) {
            return null;
        }
        BigDecimal sum = ratings.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal avg = sum.divide(BigDecimal.valueOf(ratings.size()), 10, RoundingMode.HALF_UP);
        return avg.setScale(1, RoundingMode.HALF_EVEN).doubleValue();
    }
}
