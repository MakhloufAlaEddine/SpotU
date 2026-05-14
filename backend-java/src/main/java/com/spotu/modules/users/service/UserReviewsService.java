package com.spotu.modules.users.service;

import com.spotu.error.ApiNotFoundException;
import com.spotu.modules.users.dto.UserReviewItemDto;
import com.spotu.modules.users.infra.UserReviewsRepository;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.List;

@Service
public class UserReviewsService {

    private final UserReviewsRepository repository;

    public UserReviewsService(UserReviewsRepository repository) {
        this.repository = repository;
    }

    public List<UserReviewItemDto> getUserReviews(String userId) {
        Boolean showReviews = repository.findShowReviews(userId);
        if (showReviews == null) {
            throw new ApiNotFoundException("User not found");
        }
        if (!showReviews) {
            return Collections.emptyList();
        }
        return repository.findReviewsByUserId(userId);
    }
}
