package com.spotu.modules.users.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.util.List;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class PublicProfileDto {
    private String userId;
    private String name;
    private String picture;
    private String coverPicture;
    private Double coverOffsetY;
    private Double coverScale;
    private String role;
    private String bio;
    private Boolean isCoachVerified;
    private List<String> coachTags;
    private boolean showPhone;
    private boolean showReviews;
    private String phone;
    private int followersCount;
    private int followingCount;
    @JsonProperty("is_following")
    private boolean isFollowing;
    private List<InterestDto> interests;
    private Double avgRating;
    private int reviewCount;
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private List<ServiceSummaryDto> services;
    private List<TagPointPublicDto> tagPoints;

    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getPicture() { return picture; }
    public void setPicture(String picture) { this.picture = picture; }
    public String getCoverPicture() { return coverPicture; }
    public void setCoverPicture(String coverPicture) { this.coverPicture = coverPicture; }
    public Double getCoverOffsetY() { return coverOffsetY; }
    public void setCoverOffsetY(Double coverOffsetY) { this.coverOffsetY = coverOffsetY; }
    public Double getCoverScale() { return coverScale; }
    public void setCoverScale(Double coverScale) { this.coverScale = coverScale; }
    public String getRole() { return role; }
    public void setRole(String role) { this.role = role; }
    public String getBio() { return bio; }
    public void setBio(String bio) { this.bio = bio; }
    public Boolean getIsCoachVerified() { return isCoachVerified; }
    public void setIsCoachVerified(Boolean coachVerified) { isCoachVerified = coachVerified; }
    public List<String> getCoachTags() { return coachTags; }
    public void setCoachTags(List<String> coachTags) { this.coachTags = coachTags; }
    public boolean isShowPhone() { return showPhone; }
    public void setShowPhone(boolean showPhone) { this.showPhone = showPhone; }
    public boolean isShowReviews() { return showReviews; }
    public void setShowReviews(boolean showReviews) { this.showReviews = showReviews; }
    public String getPhone() { return phone; }
    public void setPhone(String phone) { this.phone = phone; }
    public int getFollowersCount() { return followersCount; }
    public void setFollowersCount(int followersCount) { this.followersCount = followersCount; }
    public int getFollowingCount() { return followingCount; }
    public void setFollowingCount(int followingCount) { this.followingCount = followingCount; }
    public boolean getIsFollowing() { return isFollowing; }
    public void setFollowing(boolean following) { isFollowing = following; }
    public List<InterestDto> getInterests() { return interests; }
    public void setInterests(List<InterestDto> interests) { this.interests = interests; }
    public Double getAvgRating() { return avgRating; }
    public void setAvgRating(Double avgRating) { this.avgRating = avgRating; }
    public int getReviewCount() { return reviewCount; }
    public void setReviewCount(int reviewCount) { this.reviewCount = reviewCount; }
    public List<ServiceSummaryDto> getServices() { return services; }
    public void setServices(List<ServiceSummaryDto> services) { this.services = services; }
    public List<TagPointPublicDto> getTagPoints() { return tagPoints; }
    public void setTagPoints(List<TagPointPublicDto> tagPoints) { this.tagPoints = tagPoints; }
}
