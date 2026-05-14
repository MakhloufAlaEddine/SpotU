package com.spotu.modules.referential.infra;

import com.spotu.modules.auth.support.PythonIsoTimestamps;
import com.spotu.modules.referential.dto.DomainDto;
import com.spotu.modules.referential.dto.TagCategoryDto;
import com.spotu.modules.referential.dto.TagDto;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Repository
public class ReferentialRepository {

    private final JdbcTemplate jdbcTemplate;

    public ReferentialRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<DomainDto> findDomains(boolean includeInactive) {
        String sql = includeInactive
                ? "SELECT * FROM domains ORDER BY name"
                : "SELECT * FROM domains WHERE active = TRUE ORDER BY name";
        return jdbcTemplate.query(sql, this::mapDomain);
    }

    public List<TagCategoryDto> findActiveCategories(String domainId, String entityType) {
        StringBuilder sql = new StringBuilder("SELECT * FROM tag_categories tc WHERE tc.active = TRUE");
        List<Object> args = new ArrayList<>();
        if (domainId != null && !domainId.isBlank()) {
            sql.append(" AND tc.domain_id = ?");
            args.add(domainId);
        }
        if (entityType != null && !entityType.isBlank()) {
            sql.append(" AND tc.entity_type = ?");
            args.add(entityType);
        }
        sql.append(" ORDER BY tc.name");
        return jdbcTemplate.query(sql.toString(), this::mapCategoryWithoutTags, args.toArray());
    }

    public Map<String, List<TagDto>> findActiveTagsByCategoryIds(List<String> categoryIds) {
        if (categoryIds.isEmpty()) {
            return Collections.emptyMap();
        }
        String placeholders = String.join(",", Collections.nCopies(categoryIds.size(), "?"));
        String sql = """
                SELECT t.*, tcl.category_id AS linked_category_id
                FROM tags t
                JOIN tag_category_links tcl ON t.tag_id = tcl.tag_id
                WHERE t.active = TRUE AND tcl.category_id IN (%s)
                ORDER BY t.name
                """.formatted(placeholders);

        List<TagWithCategory> rows = jdbcTemplate.query(sql, (rs, rowNum) -> new TagWithCategory(
                rs.getString("linked_category_id"),
                mapTag(rs, rowNum)
        ), categoryIds.toArray());
        Map<String, List<TagDto>> out = new LinkedHashMap<>();
        for (TagWithCategory row : rows) {
            if (row.linkedCategoryId() != null) {
                out.computeIfAbsent(row.linkedCategoryId(), k -> new ArrayList<>()).add(row.tag());
            }
        }
        return out;
    }

    public List<TagDto> findTags(String domainId, String categoryId, String entityType) {
        boolean hasCategory = categoryId != null && !categoryId.isBlank();
        boolean hasEntityType = entityType != null && !entityType.isBlank();
        boolean hasDomain = domainId != null && !domainId.isBlank();

        if (hasCategory || hasEntityType) {
            StringBuilder sql = new StringBuilder("SELECT DISTINCT t.* FROM tags t");
            List<Object> args = new ArrayList<>();
            List<String> conditions = new ArrayList<>();
            conditions.add("t.active = TRUE");
            if (hasCategory) {
                sql.append(" JOIN tag_category_links tcl ON t.tag_id = tcl.tag_id");
                conditions.add("tcl.category_id = ?");
                args.add(categoryId);
            }
            if (hasEntityType) {
                sql.append(" JOIN tag_entity_type_links tetl ON t.tag_id = tetl.tag_id");
                conditions.add("tetl.entity_type = ?");
                args.add(entityType);
            }
            if (hasDomain) {
                conditions.add("t.domain_id = ?");
                args.add(domainId);
            }
            sql.append(" WHERE ").append(String.join(" AND ", conditions)).append(" ORDER BY t.name LIMIT 200");
            return jdbcTemplate.query(sql.toString(), this::mapTag, args.toArray());
        }

        if (hasDomain) {
            return jdbcTemplate.query(
                    "SELECT * FROM tags t WHERE t.active = TRUE AND t.domain_id = ? ORDER BY t.name LIMIT 200",
                    this::mapTag,
                    domainId
            );
        }

        return jdbcTemplate.query(
                "SELECT * FROM tags WHERE active = TRUE ORDER BY name LIMIT 200",
                this::mapTag
        );
    }

    private DomainDto mapDomain(ResultSet rs, int rowNum) throws SQLException {
        return new DomainDto(
                rs.getString("domain_id"),
                rs.getString("name"),
                rs.getString("label_fr"),
                rs.getString("label_en"),
                rs.getString("icon"),
                rs.getString("color"),
                readNullableBoolean(rs, "active"),
                PythonIsoTimestamps.fromTimestamp(rs.getTimestamp("created_at"))
        );
    }

    private TagCategoryDto mapCategoryWithoutTags(ResultSet rs, int rowNum) throws SQLException {
        return new TagCategoryDto(
                rs.getString("category_id"),
                rs.getString("domain_id"),
                rs.getString("entity_type"),
                rs.getString("name"),
                rs.getString("label_fr"),
                rs.getString("label_en"),
                rs.getString("icon"),
                readNullableBoolean(rs, "active"),
                PythonIsoTimestamps.fromTimestamp(rs.getTimestamp("created_at")),
                List.of()
        );
    }

    private TagDto mapTag(ResultSet rs, int rowNum) throws SQLException {
        return new TagDto(
                rs.getString("tag_id"),
                rs.getString("category_id"),
                rs.getString("domain_id"),
                rs.getString("name"),
                rs.getString("label_fr"),
                rs.getString("label_en"),
                rs.getString("icon"),
                readNullableBoolean(rs, "active"),
                PythonIsoTimestamps.fromTimestamp(rs.getTimestamp("created_at"))
        );
    }

    private static Boolean readNullableBoolean(ResultSet rs, String column) throws SQLException {
        boolean v = rs.getBoolean(column);
        return rs.wasNull() ? null : v;
    }

    public record TagWithCategory(String linkedCategoryId, TagDto tag) {
    }
}
