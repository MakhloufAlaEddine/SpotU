package com.spotu.modules.users.infra;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.common.JsonbMedia;
import com.spotu.modules.users.dto.InterestDto;
import com.spotu.modules.users.dto.ServiceSummaryDto;
import com.spotu.modules.users.dto.TagPointPublicDto;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class PublicProfileRepository {

    private static final String SELECT_PUBLIC_USER = """
            SELECT user_id, name, picture, cover_picture, cover_offset_y, cover_scale,
                   role, bio, is_coach_verified, coach_tags, show_phone, show_reviews, phone
            FROM users WHERE user_id = ?
            """;
    private static final String SELECT_FOLLOWERS_COUNT =
            "SELECT COUNT(*) FROM user_follows WHERE following_id = ?";
    private static final String SELECT_FOLLOWING_COUNT =
            "SELECT COUNT(*) FROM user_follows WHERE follower_id = ?";
    private static final String EXISTS_IS_FOLLOWING = """
            SELECT EXISTS(SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = ?)
            """;
    private static final String SELECT_TAGS = """
            SELECT tag_id, label_fr, label_en, icon FROM tags WHERE tag_id IN (%s)
            """;
    private static final String SELECT_REVIEW_RATINGS =
            "SELECT rating FROM reviews WHERE reviewee_id = ?";
    private static final String SELECT_ACTIVE_SERVICES = """
            SELECT service_id, title, description, price, duration_min, location_description,
                   max_participants, tag_ids, domain_id, images
            FROM services
            WHERE coach_id = ? AND active = TRUE
            """;
    private static final String SELECT_ACTIVE_TAG_POINTS = """
            SELECT point_id, title, images, event_date, event_schedule, domain_id, tag_ids,
                   minimum_participants, maximum_participants
            FROM tag_points
            WHERE user_id = ? AND active = TRUE
            ORDER BY created_at DESC
            LIMIT 20
            """;

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public PublicProfileRepository(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    public Optional<PublicUserRow> findPublicUserById(String userId) {
        List<PublicUserRow> rows = jdbcTemplate.query(SELECT_PUBLIC_USER, this::mapPublicUserRow, userId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public int countFollowers(String userId) {
        Integer count = jdbcTemplate.queryForObject(SELECT_FOLLOWERS_COUNT, Integer.class, userId);
        return count == null ? 0 : count;
    }

    public int countFollowing(String userId) {
        Integer count = jdbcTemplate.queryForObject(SELECT_FOLLOWING_COUNT, Integer.class, userId);
        return count == null ? 0 : count;
    }

    public boolean isFollowing(String meId, String userId) {
        Boolean exists = jdbcTemplate.queryForObject(EXISTS_IS_FOLLOWING, Boolean.class, meId, userId);
        return Boolean.TRUE.equals(exists);
    }

    public List<InterestDto> findInterestsByTagIds(List<String> tagIds) {
        if (tagIds.isEmpty()) {
            return Collections.emptyList();
        }
        String placeholders = String.join(",", Collections.nCopies(tagIds.size(), "?"));
        String sql = SELECT_TAGS.formatted(placeholders);
        return jdbcTemplate.query(sql,
                (rs, rowNum) -> new InterestDto(
                        rs.getString("tag_id"),
                        rs.getString("label_fr"),
                        rs.getString("label_en"),
                        rs.getString("icon")
                ),
                tagIds.toArray());
    }

    public List<BigDecimal> findReviewRatings(String userId) {
        return jdbcTemplate.query(SELECT_REVIEW_RATINGS, (rs, rowNum) -> rs.getBigDecimal("rating"), userId);
    }

    public List<ServiceSummaryDto> findActiveServicesByCoachId(String userId) {
        return jdbcTemplate.query(SELECT_ACTIVE_SERVICES, (rs, rowNum) -> new ServiceSummaryDto(
                rs.getString("service_id"),
                rs.getString("title"),
                rs.getString("description"),
                rs.getBigDecimal("price"),
                rs.getObject("duration_min", Integer.class),
                rs.getString("location_description"),
                rs.getObject("max_participants", Integer.class),
                parseObjectList(JsonbMedia.unwrapToJsonString(objectMapper, rs.getObject("tag_ids"))),
                rs.getString("domain_id"),
                JsonbMedia.parseImagesListForApi(objectMapper, rs.getObject("images"))
        ), userId);
    }

    public List<TagPointPublicDto> findActiveTagPointsByUserId(String userId) {
        return jdbcTemplate.query(SELECT_ACTIVE_TAG_POINTS, (rs, rowNum) -> {
            TagPointPublicDto dto = new TagPointPublicDto();
            dto.setPointId(rs.getString("point_id"));
            dto.setTitle(rs.getString("title"));
            dto.setImages(parseObjectList(JsonbMedia.unwrapToJsonString(objectMapper, rs.getObject("images"))));
            dto.setEventDate(rs.getString("event_date"));
            dto.setEventSchedule(parseObject(JsonbMedia.unwrapToJsonString(objectMapper, rs.getObject("event_schedule"))));
            dto.setDomainId(rs.getString("domain_id"));
            dto.setTagIds(parseObjectList(JsonbMedia.unwrapToJsonString(objectMapper, rs.getObject("tag_ids"))));
            dto.setMinimumParticipants(rs.getObject("minimum_participants", Integer.class));
            dto.setMaximumParticipants(rs.getObject("maximum_participants", Integer.class));
            return dto;
        }, userId);
    }

    public Map<String, Integer> batchParticipantsCount(List<String> pointIds) {
        if (pointIds.isEmpty()) {
            return Collections.emptyMap();
        }
        String placeholders = String.join(",", Collections.nCopies(pointIds.size(), "?"));
        String sql = ("SELECT spot_you_id, COUNT(*) AS cnt FROM spot_you_members " +
                "WHERE spot_you_id IN (%s) GROUP BY spot_you_id").formatted(placeholders);
        List<Map.Entry<String, Integer>> rows = jdbcTemplate.query(sql,
                (rs, rowNum) -> Map.entry(rs.getString("spot_you_id"), rs.getInt("cnt")),
                pointIds.toArray());
        Map<String, Integer> map = new HashMap<>();
        rows.forEach(e -> map.put(e.getKey(), e.getValue()));
        return map;
    }

    public Map<String, Integer> batchGoingCount(List<String> pointIds) {
        if (pointIds.isEmpty()) {
            return Collections.emptyMap();
        }
        String placeholders = String.join(",", Collections.nCopies(pointIds.size(), "?"));
        String sql = ("SELECT spot_you_id, COUNT(*) AS cnt FROM spot_you_attendance " +
                "WHERE spot_you_id IN (%s) AND status = 'going' GROUP BY spot_you_id").formatted(placeholders);
        List<Map.Entry<String, Integer>> rows = jdbcTemplate.query(sql,
                (rs, rowNum) -> Map.entry(rs.getString("spot_you_id"), rs.getInt("cnt")),
                pointIds.toArray());
        Map<String, Integer> map = new HashMap<>();
        rows.forEach(e -> map.put(e.getKey(), e.getValue()));
        return map;
    }

    public Map<String, VoteStats> batchVoteStats(List<String> pointIds) {
        if (pointIds.isEmpty()) {
            return Collections.emptyMap();
        }
        String placeholders = String.join(",", Collections.nCopies(pointIds.size(), "?"));
        String sql = ("SELECT point_id, ROUND(AVG(rating), 1) AS avg_r, COUNT(*) AS vcnt " +
                "FROM tag_point_votes WHERE point_id IN (%s) GROUP BY point_id").formatted(placeholders);
        List<Map.Entry<String, VoteStats>> rows = jdbcTemplate.query(sql,
                (rs, rowNum) -> Map.entry(
                        rs.getString("point_id"),
                        new VoteStats(rs.getDouble("avg_r"), rs.getInt("vcnt"))
                ),
                pointIds.toArray());
        Map<String, VoteStats> map = new HashMap<>();
        rows.forEach(e -> map.put(e.getKey(), e.getValue()));
        return map;
    }

    private PublicUserRow mapPublicUserRow(ResultSet rs, int rowNum) throws SQLException {
        return new PublicUserRow(
                rs.getString("user_id"),
                rs.getString("name"),
                rs.getString("picture"),
                rs.getString("cover_picture"),
                rs.getObject("cover_offset_y", Double.class),
                rs.getObject("cover_scale", Double.class),
                rs.getString("role"),
                rs.getString("bio"),
                readNullableBoolean(rs, "is_coach_verified"),
                parseStringListWithDoubleDecode(rs.getString("coach_tags")),
                rs.getBoolean("show_phone"),
                rs.getBoolean("show_reviews"),
                rs.getString("phone")
        );
    }

    private static Boolean readNullableBoolean(ResultSet rs, String column) throws SQLException {
        boolean val = rs.getBoolean(column);
        return rs.wasNull() ? null : val;
    }

    private List<String> parseStringListWithDoubleDecode(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyList();
        }
        try {
            Object first = objectMapper.readValue(json, Object.class);
            if (first instanceof List<?> l) {
                return l.stream().map(String::valueOf).toList();
            }
            if (first instanceof String s) {
                List<?> second = objectMapper.readValue(s, List.class);
                return second.stream().map(String::valueOf).toList();
            }
        } catch (Exception ignored) {
            return Collections.emptyList();
        }
        return Collections.emptyList();
    }

    private List<Object> parseObjectList(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyList();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<>() {
            });
        } catch (Exception e) {
            return Collections.emptyList();
        }
    }

    private Object parseObject(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(json, Object.class);
        } catch (Exception e) {
            return null;
        }
    }

    public record VoteStats(double rating, int voteCount) {
    }

    public record PublicUserRow(
            String userId,
            String name,
            String picture,
            String coverPicture,
            Double coverOffsetY,
            Double coverScale,
            String role,
            String bio,
            Boolean isCoachVerified,
            List<String> coachTags,
            boolean showPhone,
            boolean showReviews,
            String phone
    ) {
    }
}
