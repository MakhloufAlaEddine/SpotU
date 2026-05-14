package com.spotu.modules.services.infra;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.common.JsonbMedia;
import com.spotu.modules.auth.support.PythonIsoTimestamps;
import com.spotu.modules.services.dto.CoachSummaryDto;
import com.spotu.modules.services.dto.ServiceLocationDto;
import com.spotu.modules.services.dto.ServicePackageDto;
import com.spotu.modules.services.dto.ServicePackageSlotDto;
import com.spotu.modules.services.dto.ServiceSlotDto;
import com.spotu.modules.services.dto.TagDetailDto;
import org.springframework.dao.DataAccessException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.StringJoiner;

@Repository
public class ServicesRepository {

    private static final List<String> ACTIVE_BOOKING_STATUSES = List.of("pending", "accepted", "awaiting_payment", "confirmed");

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final String jdbcUrl;

    public ServicesRepository(
            JdbcTemplate jdbcTemplate,
            ObjectMapper objectMapper,
            @Value("${spring.datasource.url:}") String jdbcUrl
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
        this.jdbcUrl = jdbcUrl == null ? "" : jdbcUrl;
    }

    public List<ServiceRow> searchServices(Double lat, Double lng, Integer radius, String coachId, String domainId, String currentUserId) {
        StringBuilder baseSql = new StringBuilder("""
                SELECT service_id, coach_id, title, description, address, price, duration_min,
                       tag_ids, domain_id, location_description, max_participants, active, images, created_at, updated_at,
                       booking_approval_mode, allow_pay_later, pay_later_expiration_minutes
                FROM services
                WHERE active = TRUE
                """);
        List<Object> baseArgs = new ArrayList<>();
        if (currentUserId != null && !currentUserId.isBlank()) {
            baseSql.append(" AND coach_id <> ?");
            baseArgs.add(currentUserId);
        }
        if (coachId != null && !coachId.isBlank()) {
            baseSql.append(" AND coach_id = ?");
            baseArgs.add(coachId);
        }
        if (domainId != null && !domainId.isBlank()) {
            baseSql.append(" AND domain_id = ?");
            baseArgs.add(domainId);
        }
        StringBuilder sql = new StringBuilder(baseSql);
        List<Object> args = new ArrayList<>(baseArgs);
        if (lat != null && lng != null) {
            Integer effectiveRadius = radius == null ? 10000 : radius;
            try {
                sql.append("""
                         AND EXISTS (
                            SELECT 1 FROM service_locations sl
                            WHERE sl.service_id = services.service_id
                              AND ST_DWithin(
                                sl.location::geography,
                                ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
                                ?
                              )
                        )
                        """);
                args.add(lng);
                args.add(lat);
                args.add(effectiveRadius);
                sql.append(" LIMIT 100");
                return jdbcTemplate.query(sql.toString(), this::mapServiceRow, args.toArray());
            } catch (DataAccessException ignored1) {
                // Schéma prod : coordonnées dérivées de sl.location (pas de colonnes latitude/longitude).
                try {
                    sql = new StringBuilder(baseSql);
                    args = new ArrayList<>(baseArgs);
                    sql.append("""
                             AND EXISTS (
                                SELECT 1 FROM service_locations sl
                                WHERE sl.service_id = services.service_id
                                  AND sl.location IS NOT NULL
                                  AND (
                                    POWER((ST_Y(sl.location::geometry) - ?) * 111320, 2)
                                    + POWER((ST_X(sl.location::geometry) - ?) * 111320, 2)
                                  ) <= POWER(?, 2)
                            )
                            """);
                    args.add(lat);
                    args.add(lng);
                    args.add(effectiveRadius);
                    sql.append(" LIMIT 100");
                    return jdbcTemplate.query(sql.toString(), this::mapServiceRow, args.toArray());
                } catch (DataAccessException ignored2) {
                    // H2 / jeux de tests : colonnes latitude, longitude.
                    sql = new StringBuilder(baseSql);
                    args = new ArrayList<>(baseArgs);
                    sql.append("""
                             AND EXISTS (
                                SELECT 1 FROM service_locations sl
                                WHERE sl.service_id = services.service_id
                                  AND (
                                    POWER((sl.latitude - ?) * 111320, 2)
                                    + POWER((sl.longitude - ?) * 111320, 2)
                                  ) <= POWER(?, 2)
                            )
                            """);
                    args.add(lat);
                    args.add(lng);
                    args.add(effectiveRadius);
                }
            }
        }
        sql.append(" LIMIT 100");
        return jdbcTemplate.query(sql.toString(), this::mapServiceRow, args.toArray());
    }

    public Optional<ServiceRow> findServiceById(String serviceId) {
        List<ServiceRow> rows = jdbcTemplate.query("""
                SELECT service_id, coach_id, title, description, address, price, duration_min,
                       tag_ids, domain_id, location_description, max_participants, active, images, created_at, updated_at,
                       booking_approval_mode, allow_pay_later, pay_later_expiration_minutes
                FROM services
                WHERE service_id = ?
                """, this::mapServiceRow, serviceId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public boolean existsActiveServiceById(String serviceId) {
        Integer v = jdbcTemplate.query(
                "SELECT 1 FROM services WHERE service_id = ? AND active = TRUE",
                rs -> rs.next() ? 1 : null,
                serviceId
        );
        return v != null;
    }

    public Optional<Map<String, Object>> findWriteGuardRow(String serviceId) {
        List<Map<String, Object>> rows = jdbcTemplate.query("""
                SELECT service_id, coach_id, active, deleted_at, deleted_by, media_purged, images
                FROM services
                WHERE service_id = ?
                """, (rs, rowNum) -> {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("service_id", rs.getString("service_id"));
            out.put("coach_id", rs.getString("coach_id"));
            out.put("active", readNullableBoolean(rs, "active"));
            out.put("deleted_at", rs.getTimestamp("deleted_at"));
            out.put("deleted_by", rs.getString("deleted_by"));
            out.put("media_purged", readNullableBoolean(rs, "media_purged"));
            out.put("images", rs.getString("images"));
            return out;
        }, serviceId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Map<String, Boolean> readBookingFlags() {
        Map<String, Boolean> out = new LinkedHashMap<>();
        out.put("enable_manual_approval_for_services", false);
        out.put("enable_pay_later_for_services", false);
        List<Map<String, Object>> rows = jdbcTemplate.query("""
                SELECT config_key, config_value
                FROM app_config
                WHERE config_key IN ('enable_manual_approval_for_services', 'enable_pay_later_for_services')
                """, (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("config_key", rs.getString("config_key"));
            row.put("config_value", rs.getString("config_value"));
            return row;
        });
        for (Map<String, Object> row : rows) {
            String key = String.valueOf(row.get("config_key"));
            String value = String.valueOf(row.get("config_value"));
            out.put(key, "true".equalsIgnoreCase(value));
        }
        return out;
    }

    public void insertService(Map<String, Object> write) {
        jdbcTemplate.update("""
                INSERT INTO services
                  (service_id, coach_id, title, description, address, price, duration_min,
                   tag_ids, domain_id, max_participants, images, active,
                   booking_approval_mode, allow_pay_later, pay_later_expiration_minutes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?, ?)
                """,
                write.get("service_id"),
                write.get("coach_id"),
                write.get("title"),
                write.get("description"),
                write.get("address"),
                write.get("price"),
                write.get("duration_min"),
                write.get("tag_ids"),
                write.get("domain_id"),
                write.get("max_participants"),
                write.get("images"),
                write.get("booking_approval_mode"),
                write.get("allow_pay_later"),
                write.get("pay_later_expiration_minutes")
        );
    }

    public int updateServiceDynamic(String serviceId, Map<String, Object> setValues) {
        List<String> clauses = new ArrayList<>();
        List<Object> args = new ArrayList<>();
        for (Map.Entry<String, Object> e : setValues.entrySet()) {
            clauses.add(e.getKey() + " = ?");
            args.add(e.getValue());
        }
        clauses.add("updated_at = NOW()");
        args.add(serviceId);
        String sql = "UPDATE services SET " + String.join(", ", clauses) + " WHERE service_id = ?";
        return jdbcTemplate.update(sql, args.toArray());
    }

    public void replaceLocations(String serviceId, List<Map<String, Object>> locations) {
        jdbcTemplate.update("DELETE FROM service_locations WHERE service_id = ?", serviceId);
        if (locations == null || locations.isEmpty()) {
            return;
        }
        for (Map<String, Object> loc : locations) {
            try {
                jdbcTemplate.update("""
                        INSERT INTO service_locations
                          (location_id, service_id, location, "precision", description)
                        VALUES (?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326), ?, ?)
                        """,
                        String.valueOf(loc.get("location_id")),
                        serviceId,
                        loc.get("longitude"),
                        loc.get("latitude"),
                        loc.get("precision"),
                        loc.get("description")
                );
            } catch (DataAccessException ex) {
                // H2 / schéma de test avec lat,lng et sans colonne geometry typée
                jdbcTemplate.update("""
                        INSERT INTO service_locations
                          (location_id, service_id, location, precision, description, latitude, longitude)
                        VALUES (?, ?, NULL, ?, ?, ?, ?)
                        """,
                        String.valueOf(loc.get("location_id")),
                        serviceId,
                        loc.get("precision"),
                        loc.get("description"),
                        loc.get("latitude"),
                        loc.get("longitude")
                );
            }
        }
    }

    public void deleteSlotsByServiceId(String serviceId) {
        jdbcTemplate.update("DELETE FROM service_slots WHERE service_id = ?", serviceId);
    }

    public void insertSlot(
            String slotId,
            String serviceId,
            String locationId,
            String slotType,
            String daysOfWeekJson,
            Integer dayOfWeek,
            String startTime,
            String endTime,
            String slotDate
    ) {
        jdbcTemplate.update("""
                INSERT INTO service_slots
                  (slot_id, service_id, location_id, slot_type, days_of_week, day_of_week, start_time, end_time, slot_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                slotId, serviceId, locationId, slotType, daysOfWeekJson, dayOfWeek, startTime, endTime, slotDate
        );
    }

    public void insertPackage(
            String packageId,
            String serviceId,
            String typeId,
            String typeLabel,
            Integer durationMin,
            Integer maxParticipants,
            BigDecimal price
    ) {
        jdbcTemplate.update("""
                INSERT INTO service_packages
                  (package_id, service_id, type_id, type_label, duration_min, max_participants, price)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                packageId, serviceId, typeId, typeLabel, durationMin, maxParticipants, price
        );
    }

    public void insertPackageSlot(
            String slotId,
            String serviceId,
            String packageId,
            String slotDate,
            String startTime,
            String endTime
    ) {
        jdbcTemplate.update("""
                INSERT INTO service_slots
                  (slot_id, service_id, package_id, slot_type, slot_date, start_time, end_time)
                VALUES (?, ?, ?, 'single', ?, ?, ?)
                """,
                slotId, serviceId, packageId, slotDate, startTime, endTime
        );
    }

    public List<String> findLocationIdsByServiceIdOrdered(String serviceId) {
        try {
            return jdbcTemplate.query(
                    "SELECT location_id FROM service_locations WHERE service_id = ? ORDER BY created_at, location_id",
                    (rs, rn) -> rs.getString("location_id"),
                    serviceId
            );
        } catch (DataAccessException ex) {
            return jdbcTemplate.query(
                    "SELECT location_id FROM service_locations WHERE service_id = ? ORDER BY location_id",
                    (rs, rn) -> rs.getString("location_id"),
                    serviceId
            );
        }
    }

    public int countActiveBookingsByServiceId(String serviceId) {
        Integer count = jdbcTemplate.queryForObject("""
                SELECT COUNT(*) FROM bookings
                WHERE service_id = ?
                  AND status IN ('pending','accepted','awaiting_payment','confirmed')
                """, Integer.class, serviceId);
        return count == null ? 0 : count;
    }

    public void softDeleteService(String serviceId, String deletedBy, Timestamp now, Timestamp mediaPurgeAt) {
        jdbcTemplate.update("""
                UPDATE services
                SET active = FALSE,
                    deleted_at = ?,
                    deleted_by = ?,
                    updated_at = ?,
                    media_purge_scheduled_at = ?
                WHERE service_id = ?
                """, now, deletedBy, now, mediaPurgeAt, serviceId);
    }

    public void reactivateService(String serviceId, Timestamp now) {
        jdbcTemplate.update("""
                UPDATE services
                SET active = TRUE,
                    deleted_at = NULL,
                    deleted_by = NULL,
                    updated_at = ?,
                    media_purge_scheduled_at = NULL,
                    media_purge_notified_at = NULL,
                    reactivated_at = ?
                WHERE service_id = ?
                """, now, now, serviceId);
    }

    public int markConversationsDeleted(String serviceId) {
        return jdbcTemplate.update(
                "UPDATE conversations SET context_deleted = TRUE WHERE context_id = ? AND context_deleted = FALSE",
                serviceId
        );
    }

    public int markConversationsActive(String serviceId) {
        return jdbcTemplate.update(
                "UPDATE conversations SET context_deleted = FALSE WHERE context_id = ? AND context_deleted = TRUE",
                serviceId
        );
    }

    public void scheduleFileDeletion(String fileUrl, String entityType, String entityId, Timestamp scheduledAt) {
        if (jdbcUrl.startsWith("jdbc:postgresql:")) {
            jdbcTemplate.update("""
                    INSERT INTO pending_file_deletions(file_url, entity_type, entity_id, scheduled_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT DO NOTHING
                    """, fileUrl, entityType, entityId, scheduledAt);
            return;
        }
        jdbcTemplate.update("""
                INSERT INTO pending_file_deletions(file_url, entity_type, entity_id, scheduled_at, status)
                SELECT ?, ?, ?, ?, 'pending'
                WHERE NOT EXISTS (
                    SELECT 1 FROM pending_file_deletions WHERE file_url = ? AND entity_id = ?
                )
                """, fileUrl, entityType, entityId, scheduledAt, fileUrl, entityId);
    }

    public int cancelPendingFileDeletions(String entityId) {
        return jdbcTemplate.update(
                "DELETE FROM pending_file_deletions WHERE entity_id = ? AND status = 'pending'",
                entityId
        );
    }

    public void saveServiceForUser(String serviceId, String userId) {
        String saveId = "svs_" + java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        if (jdbcUrl.startsWith("jdbc:postgresql:")) {
            jdbcTemplate.update("""
                    INSERT INTO service_saves (save_id, service_id, user_id)
                    VALUES (?, ?, ?)
                    ON CONFLICT DO NOTHING
                    """, saveId, serviceId, userId);
            return;
        }
        jdbcTemplate.update("""
                INSERT INTO service_saves (save_id, service_id, user_id, saved_at)
                SELECT ?, ?, ?, CURRENT_TIMESTAMP
                WHERE NOT EXISTS (
                    SELECT 1 FROM service_saves WHERE service_id = ? AND user_id = ?
                )
                """, saveId, serviceId, userId, serviceId, userId);
    }

    public int unsaveServiceForUser(String serviceId, String userId) {
        return jdbcTemplate.update(
                "DELETE FROM service_saves WHERE service_id = ? AND user_id = ?",
                serviceId, userId
        );
    }

    public List<ServiceRow> findMineByCoachId(String coachId) {
        return jdbcTemplate.query("""
                SELECT service_id, coach_id, title, description, address, price, duration_min,
                       tag_ids, domain_id, location_description, max_participants, active, images, created_at, updated_at,
                       booking_approval_mode, allow_pay_later, pay_later_expiration_minutes
                FROM services
                WHERE coach_id = ? AND active = TRUE
                ORDER BY created_at DESC
                """, this::mapServiceRow, coachId);
    }

    public List<DeactivatedServiceRow> findDeactivatedByCoachId(String coachId) {
        return jdbcTemplate.query("""
                SELECT service_id, coach_id, title, description, address, price, duration_min,
                       tag_ids, domain_id, location_description, max_participants, active, images, created_at, updated_at,
                       booking_approval_mode, allow_pay_later, pay_later_expiration_minutes,
                       deleted_at, media_purge_scheduled_at, media_purged, reactivated_at
                FROM services
                WHERE coach_id = ? AND deleted_at IS NOT NULL
                  AND (reactivated_at IS NULL OR reactivated_at < deleted_at)
                ORDER BY deleted_at DESC
                """, this::mapDeactivatedServiceRow, coachId);
    }

    public List<SavedServiceRow> findSavedByUserId(String userId) {
        List<SavedServiceRow> rows;
        try {
            rows = jdbcTemplate.query("""
                SELECT s.service_id, s.title, s.price, s.images, s.address, s.location_description,
                       s.duration_min, ss.saved_at,
                       u.user_id as coach_user_id, u.name as coach_name, u.picture as coach_picture,
                       ST_Y(sl.location::geometry) AS latitude, ST_X(sl.location::geometry) AS longitude,
                       (SELECT COUNT(*) FROM service_slots slt
                        WHERE slt.service_id = s.service_id
                          AND slt.slot_status = 'available'
                          AND slt.slot_date >= TO_CHAR(NOW(), 'YYYY-MM-DD')) as available_slots
                FROM service_saves ss
                JOIN services s ON ss.service_id = s.service_id
                JOIN users u ON s.coach_id = u.user_id
                LEFT JOIN service_locations sl ON sl.service_id = s.service_id
                WHERE ss.user_id = ?
                ORDER BY ss.saved_at DESC
                """, (rs, rowNum) -> new SavedServiceRow(
                rs.getString("service_id"),
                rs.getString("title"),
                rs.getBigDecimal("price"),
                JsonbMedia.parseImagesListForApi(objectMapper, rs.getObject("images")),
                rs.getString("address"),
                rs.getString("location_description"),
                rs.getObject("duration_min", Integer.class),
                PythonIsoTimestamps.fromTimestamp(rs.getTimestamp("saved_at")),
                new CoachSummaryDto(
                        rs.getString("coach_user_id"),
                        rs.getString("coach_name"),
                        rs.getString("coach_picture"),
                        null
                ),
                rs.getObject("latitude", Double.class),
                rs.getObject("longitude", Double.class),
                rs.getInt("available_slots")
            ), userId);
        } catch (DataAccessException ex) {
            rows = jdbcTemplate.query("""
                    SELECT s.service_id, s.title, s.price, s.images, s.address, s.location_description,
                           s.duration_min, ss.saved_at,
                           u.user_id as coach_user_id, u.name as coach_name, u.picture as coach_picture,
                           sl.latitude, sl.longitude,
                           (SELECT COUNT(*) FROM service_slots slt
                            WHERE slt.service_id = s.service_id
                              AND slt.slot_status = 'available'
                              AND CAST(slt.slot_date AS DATE) >= CURRENT_DATE) as available_slots
                    FROM service_saves ss
                    JOIN services s ON ss.service_id = s.service_id
                    JOIN users u ON s.coach_id = u.user_id
                    LEFT JOIN service_locations sl ON sl.service_id = s.service_id
                    WHERE ss.user_id = ?
                    ORDER BY ss.saved_at DESC
                    """, (rs, rowNum) -> new SavedServiceRow(
                    rs.getString("service_id"),
                    rs.getString("title"),
                    rs.getBigDecimal("price"),
                    JsonbMedia.parseImagesListForApi(objectMapper, rs.getObject("images")),
                    rs.getString("address"),
                    rs.getString("location_description"),
                    rs.getObject("duration_min", Integer.class),
                    PythonIsoTimestamps.fromTimestamp(rs.getTimestamp("saved_at")),
                    new CoachSummaryDto(
                            rs.getString("coach_user_id"),
                            rs.getString("coach_name"),
                            rs.getString("coach_picture"),
                            null
                    ),
                    rs.getObject("latitude", Double.class),
                    rs.getObject("longitude", Double.class),
                    rs.getInt("available_slots")
            ), userId);
        }

        // preserve one row per service (first location semantics)
        Map<String, SavedServiceRow> dedup = new LinkedHashMap<>();
        for (SavedServiceRow r : rows) {
            dedup.putIfAbsent(r.serviceId(), r);
        }
        return new ArrayList<>(dedup.values());
    }

    public Map<String, CoachSummaryDto> findCoachesByIds(List<String> coachIds) {
        if (coachIds.isEmpty()) {
            return Collections.emptyMap();
        }
        String placeholders = String.join(",", Collections.nCopies(coachIds.size(), "?"));
        String sql = ("SELECT user_id, name, picture, is_coach_verified FROM users WHERE user_id IN (%s)").formatted(placeholders);
        List<Map.Entry<String, CoachSummaryDto>> rows = jdbcTemplate.query(sql, (rs, rowNum) -> Map.entry(
                rs.getString("user_id"),
                new CoachSummaryDto(
                        rs.getString("user_id"),
                        rs.getString("name"),
                        rs.getString("picture"),
                        readNullableBoolean(rs, "is_coach_verified")
                )
        ), coachIds.toArray());
        Map<String, CoachSummaryDto> out = new HashMap<>();
        rows.forEach(e -> out.put(e.getKey(), e.getValue()));
        return out;
    }

    public Map<String, ReviewStats> findReviewStatsByCoachIds(List<String> coachIds) {
        if (coachIds.isEmpty()) {
            return Collections.emptyMap();
        }
        String placeholders = String.join(",", Collections.nCopies(coachIds.size(), "?"));
        String sql = ("SELECT reviewee_id, ROUND(AVG(rating), 1) AS avg_rating, COUNT(*) AS review_count " +
                "FROM reviews WHERE reviewee_id IN (%s) GROUP BY reviewee_id").formatted(placeholders);
        List<Map.Entry<String, ReviewStats>> rows = jdbcTemplate.query(sql, (rs, rowNum) -> {
            var avgBd = rs.getBigDecimal("avg_rating");
            Double avgRating = avgBd == null ? null : avgBd.doubleValue();
            return Map.entry(
                    rs.getString("reviewee_id"),
                    new ReviewStats(avgRating, rs.getInt("review_count"))
            );
        }, coachIds.toArray());
        Map<String, ReviewStats> out = new HashMap<>();
        rows.forEach(e -> out.put(e.getKey(), e.getValue()));
        return out;
    }

    public Map<String, List<ServiceLocationDto>> findLocationsByServiceIds(List<String> serviceIds) {
        if (serviceIds.isEmpty()) {
            return Collections.emptyMap();
        }
        String placeholders = String.join(",", Collections.nCopies(serviceIds.size(), "?"));
        List<LocationRow> rows;
        try {
            String sql = ("SELECT service_id, location_id, \"precision\", description, " +
                    "ST_Y(sl.location::geometry) AS latitude, ST_X(sl.location::geometry) AS longitude " +
                    "FROM service_locations sl WHERE service_id IN (%s)").formatted(placeholders);
            rows = jdbcTemplate.query(sql, (rs, rowNum) -> new LocationRow(
                    rs.getString("service_id"),
                    rs.getString("location_id"),
                    rs.getString("precision"),
                    rs.getString("description"),
                    rs.getObject("latitude", Double.class),
                    rs.getObject("longitude", Double.class)
            ), serviceIds.toArray());
        } catch (DataAccessException ex) {
            String sql = ("SELECT service_id, location_id, precision, description, latitude, longitude " +
                    "FROM service_locations WHERE service_id IN (%s)").formatted(placeholders);
            rows = jdbcTemplate.query(sql, (rs, rowNum) -> new LocationRow(
                    rs.getString("service_id"),
                    rs.getString("location_id"),
                    rs.getString("precision"),
                    rs.getString("description"),
                    rs.getObject("latitude", Double.class),
                    rs.getObject("longitude", Double.class)
            ), serviceIds.toArray());
        }
        Map<String, List<ServiceLocationDto>> out = new LinkedHashMap<>();
        for (LocationRow row : rows) {
            out.computeIfAbsent(row.serviceId(), k -> new ArrayList<>())
                    .add(new ServiceLocationDto(row.locationId(), row.precision(), row.description(), row.latitude(), row.longitude(), null));
        }
        return out;
    }

    public Map<String, List<ServiceSlotDto>> findAvailableSlotsByServiceIds(List<String> serviceIds) {
        if (serviceIds.isEmpty()) {
            return Collections.emptyMap();
        }
        String servicePlaceholders = String.join(",", Collections.nCopies(serviceIds.size(), "?"));
        String bookingPlaceholders = String.join(",", Collections.nCopies(ACTIVE_BOOKING_STATUSES.size(), "?"));
        String sql = """
                SELECT ss.service_id, ss.slot_id, ss.slot_type, ss.slot_status, ss.location_id, ss.package_id,
                       ss.day_of_week, ss.days_of_week, ss.start_time, ss.end_time, ss.slot_date
                FROM service_slots ss
                WHERE ss.service_id IN (%s)
                  AND (
                    ss.slot_date IS NULL
                    OR CAST(ss.slot_date AS DATE) > CURRENT_DATE
                    OR (CAST(ss.slot_date AS DATE) = CURRENT_DATE AND CAST(ss.start_time AS TIME) > CURRENT_TIME)
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM bookings b
                    WHERE b.slot_id = ss.slot_id
                      AND b.status IN (%s)
                  )
                ORDER BY CAST(ss.slot_date AS DATE) NULLS LAST, ss.start_time
                """.formatted(servicePlaceholders, bookingPlaceholders);
        List<Object> args = new ArrayList<>(serviceIds);
        args.addAll(ACTIVE_BOOKING_STATUSES);
        List<ServiceSlotRow> rows = jdbcTemplate.query(sql, (rs, rowNum) -> new ServiceSlotRow(
                rs.getString("service_id"),
                rs.getString("slot_id"),
                rs.getString("slot_type"),
                rs.getString("slot_status"),
                rs.getString("location_id"),
                rs.getString("package_id"),
                rs.getObject("day_of_week", Integer.class),
                parseIntegerList(rs.getString("days_of_week")),
                rs.getString("start_time"),
                rs.getString("end_time"),
                rs.getString("slot_date")
        ), args.toArray());

        Map<String, List<ServiceSlotDto>> out = new LinkedHashMap<>();
        for (ServiceSlotRow row : rows) {
            out.computeIfAbsent(row.serviceId(), k -> new ArrayList<>())
                    .add(new ServiceSlotDto(
                            row.slotId(),
                            row.slotType(),
                            row.slotStatus(),
                            row.locationId(),
                            row.packageId(),
                            row.dayOfWeek(),
                            row.daysOfWeek(),
                            row.startTime(),
                            row.endTime(),
                            row.slotDate()
                    ));
        }
        return out;
    }

    public Map<String, List<ServicePackageDto>> findPackagesByServiceIds(List<String> serviceIds) {
        if (serviceIds.isEmpty()) {
            return Collections.emptyMap();
        }
        String placeholders = String.join(",", Collections.nCopies(serviceIds.size(), "?"));
        String sql = ("SELECT service_id, package_id, type_id, type_label, duration_min, max_participants, price " +
                "FROM service_packages WHERE service_id IN (%s) ORDER BY created_at").formatted(placeholders);
        List<ServicePackageRow> rows = jdbcTemplate.query(sql, (rs, rowNum) -> new ServicePackageRow(
                rs.getString("service_id"),
                rs.getString("package_id"),
                rs.getString("type_id"),
                rs.getString("type_label"),
                rs.getObject("duration_min", Integer.class),
                rs.getObject("max_participants", Integer.class),
                rs.getBigDecimal("price")
        ), serviceIds.toArray());

        List<String> packageIds = rows.stream().map(ServicePackageRow::packageId).toList();
        Map<String, List<ServicePackageSlotDto>> slotsByPackage = findPackageSlotsByPackageIds(packageIds);

        Map<String, List<ServicePackageDto>> out = new LinkedHashMap<>();
        for (ServicePackageRow row : rows) {
            out.computeIfAbsent(row.serviceId(), k -> new ArrayList<>())
                    .add(new ServicePackageDto(
                            row.packageId(),
                            row.typeId(),
                            row.typeLabel(),
                            row.durationMin(),
                            row.maxParticipants(),
                            row.price(),
                            slotsByPackage.getOrDefault(row.packageId(), Collections.emptyList())
                    ));
        }
        return out;
    }

    private Map<String, List<ServicePackageSlotDto>> findPackageSlotsByPackageIds(List<String> packageIds) {
        if (packageIds.isEmpty()) {
            return Collections.emptyMap();
        }
        String packagePlaceholders = String.join(",", Collections.nCopies(packageIds.size(), "?"));
        String bookingPlaceholders = String.join(",", Collections.nCopies(ACTIVE_BOOKING_STATUSES.size(), "?"));
        String sql = """
                SELECT ss.package_id, ss.slot_id, ss.slot_date, ss.start_time, ss.end_time
                FROM service_slots ss
                WHERE ss.package_id IN (%s)
                  AND (
                    ss.slot_date IS NULL
                    OR CAST(ss.slot_date AS DATE) > CURRENT_DATE
                    OR (CAST(ss.slot_date AS DATE) = CURRENT_DATE AND CAST(ss.start_time AS TIME) > CURRENT_TIME)
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM bookings b
                    WHERE b.slot_id = ss.slot_id
                      AND b.status IN (%s)
                  )
                ORDER BY CAST(ss.slot_date AS DATE), ss.start_time
                """.formatted(packagePlaceholders, bookingPlaceholders);
        List<Object> args = new ArrayList<>(packageIds);
        args.addAll(ACTIVE_BOOKING_STATUSES);
        List<ServicePackageSlotRow> rows = jdbcTemplate.query(sql, (rs, rowNum) -> new ServicePackageSlotRow(
                rs.getString("package_id"),
                rs.getString("slot_id"),
                rs.getString("slot_date"),
                rs.getString("start_time"),
                rs.getString("end_time")
        ), args.toArray());
        Map<String, List<ServicePackageSlotDto>> out = new LinkedHashMap<>();
        for (ServicePackageSlotRow row : rows) {
            out.computeIfAbsent(row.packageId(), k -> new ArrayList<>())
                    .add(new ServicePackageSlotDto(row.slotId(), row.slotDate(), row.startTime(), row.endTime()));
        }
        return out;
    }

    public Map<String, TagDetailDto> findTagsByIds(List<String> tagIds) {
        if (tagIds.isEmpty()) {
            return Collections.emptyMap();
        }
        String placeholders = String.join(",", Collections.nCopies(tagIds.size(), "?"));
        String sql = ("SELECT tag_id, label_fr, label_en, category_id FROM tags WHERE tag_id IN (%s)").formatted(placeholders);
        List<Map.Entry<String, TagDetailDto>> rows = jdbcTemplate.query(sql, (rs, rowNum) -> Map.entry(
                rs.getString("tag_id"),
                new TagDetailDto(
                        rs.getString("tag_id"),
                        rs.getString("label_fr"),
                        rs.getString("label_en"),
                        rs.getString("category_id")
                )
        ), tagIds.toArray());
        Map<String, TagDetailDto> out = new HashMap<>();
        rows.forEach(e -> out.put(e.getKey(), e.getValue()));
        return out;
    }

    private ServiceRow mapServiceRow(ResultSet rs, int rowNum) throws SQLException {
        return new ServiceRow(
                rs.getString("service_id"),
                rs.getString("coach_id"),
                rs.getString("title"),
                rs.getString("description"),
                rs.getString("address"),
                rs.getBigDecimal("price"),
                rs.getObject("duration_min", Integer.class),
                parseStringList(JsonbMedia.unwrapToJsonString(objectMapper, rs.getObject("tag_ids"))),
                rs.getString("domain_id"),
                rs.getString("location_description"),
                rs.getObject("max_participants", Integer.class),
                readNullableBoolean(rs, "active"),
                JsonbMedia.parseImagesListForApi(objectMapper, rs.getObject("images")),
                PythonIsoTimestamps.fromTimestamp(rs.getTimestamp("created_at")),
                PythonIsoTimestamps.fromTimestamp(rs.getTimestamp("updated_at")),
                rs.getString("booking_approval_mode"),
                readNullableBoolean(rs, "allow_pay_later"),
                rs.getObject("pay_later_expiration_minutes", Integer.class)
        );
    }

    private DeactivatedServiceRow mapDeactivatedServiceRow(ResultSet rs, int rowNum) throws SQLException {
        return new DeactivatedServiceRow(
                mapServiceRow(rs, rowNum),
                PythonIsoTimestamps.fromTimestamp(rs.getTimestamp("deleted_at")),
                PythonIsoTimestamps.fromTimestamp(rs.getTimestamp("media_purge_scheduled_at")),
                readNullableBoolean(rs, "media_purged"),
                PythonIsoTimestamps.fromTimestamp(rs.getTimestamp("reactivated_at"))
        );
    }

    private static Boolean readNullableBoolean(ResultSet rs, String column) throws SQLException {
        boolean val = rs.getBoolean(column);
        return rs.wasNull() ? null : val;
    }

    private List<String> parseStringList(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyList();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<>() {
            });
        } catch (Exception ignored) {
            return Collections.emptyList();
        }
    }

    private List<Integer> parseIntegerList(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(json, new TypeReference<>() {
            });
        } catch (Exception ignored) {
            return null;
        }
    }

    private List<Object> parseObjectList(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyList();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<>() {
            });
        } catch (Exception ignored) {
            return Collections.emptyList();
        }
    }

    public record ServiceRow(
            String serviceId,
            String coachId,
            String title,
            String description,
            String address,
            BigDecimal price,
            Integer durationMin,
            List<String> tagIds,
            String domainId,
            String locationDescription,
            Integer maxParticipants,
            Boolean active,
            List<Object> images,
            String createdAt,
            String updatedAt,
            String bookingApprovalMode,
            Boolean allowPayLater,
            Integer payLaterExpirationMinutes
    ) {
    }

    public record ReviewStats(Double avgRating, Integer reviewCount) {
    }

    public record SavedServiceRow(
            String serviceId,
            String title,
            BigDecimal price,
            List<Object> images,
            String address,
            String locationDescription,
            Integer durationMin,
            String savedAt,
            CoachSummaryDto coach,
            Double latitude,
            Double longitude,
            Integer availableSlots
    ) {
    }

    public record DeactivatedServiceRow(
            ServiceRow service,
            String deletedAt,
            String mediaPurgeScheduledAt,
            Boolean mediaPurged,
            String reactivatedAt
    ) {
    }

    private record LocationRow(
            String serviceId,
            String locationId,
            String precision,
            String description,
            Double latitude,
            Double longitude
    ) {
    }

    private record ServiceSlotRow(
            String serviceId,
            String slotId,
            String slotType,
            String slotStatus,
            String locationId,
            String packageId,
            Integer dayOfWeek,
            List<Integer> daysOfWeek,
            String startTime,
            String endTime,
            String slotDate
    ) {
    }

    private record ServicePackageRow(
            String serviceId,
            String packageId,
            String typeId,
            String typeLabel,
            Integer durationMin,
            Integer maxParticipants,
            BigDecimal price
    ) {
    }

    private record ServicePackageSlotRow(
            String packageId,
            String slotId,
            String slotDate,
            String startTime,
            String endTime
    ) {
    }
}
