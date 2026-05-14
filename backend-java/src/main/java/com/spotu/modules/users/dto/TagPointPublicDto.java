package com.spotu.modules.users.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.util.List;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class TagPointPublicDto {
    private String pointId;
    private String title;
    private List<Object> images;
    private String eventDate;
    private Object eventSchedule;
    private String domainId;
    private List<Object> tagIds;
    private Integer minimumParticipants;
    private Integer maximumParticipants;
    private int participantsCount;
    private int goingCount;
    private double rating;
    private int voteCount;
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private String nextSessionDate;
    @JsonProperty("is_full")
    private boolean isFull;

    public String getPointId() { return pointId; }
    public void setPointId(String pointId) { this.pointId = pointId; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public List<Object> getImages() { return images; }
    public void setImages(List<Object> images) { this.images = images; }
    public String getEventDate() { return eventDate; }
    public void setEventDate(String eventDate) { this.eventDate = eventDate; }
    public Object getEventSchedule() { return eventSchedule; }
    public void setEventSchedule(Object eventSchedule) { this.eventSchedule = eventSchedule; }
    public String getDomainId() { return domainId; }
    public void setDomainId(String domainId) { this.domainId = domainId; }
    public List<Object> getTagIds() { return tagIds; }
    public void setTagIds(List<Object> tagIds) { this.tagIds = tagIds; }
    public Integer getMinimumParticipants() { return minimumParticipants; }
    public void setMinimumParticipants(Integer minimumParticipants) { this.minimumParticipants = minimumParticipants; }
    public Integer getMaximumParticipants() { return maximumParticipants; }
    public void setMaximumParticipants(Integer maximumParticipants) { this.maximumParticipants = maximumParticipants; }
    public int getParticipantsCount() { return participantsCount; }
    public void setParticipantsCount(int participantsCount) { this.participantsCount = participantsCount; }
    public int getGoingCount() { return goingCount; }
    public void setGoingCount(int goingCount) { this.goingCount = goingCount; }
    public double getRating() { return rating; }
    public void setRating(double rating) { this.rating = rating; }
    public int getVoteCount() { return voteCount; }
    public void setVoteCount(int voteCount) { this.voteCount = voteCount; }
    public String getNextSessionDate() { return nextSessionDate; }
    public void setNextSessionDate(String nextSessionDate) { this.nextSessionDate = nextSessionDate; }
    public boolean getIsFull() { return isFull; }
    public void setFull(boolean full) { isFull = full; }
}
