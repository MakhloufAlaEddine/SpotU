package com.spotu.common;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Fragments SQL dépendants du SGBD (PostgreSQL jsonb vs H2 tests en VARCHAR).
 */
@Component
public class JdbcSqlDialect {

    private final boolean postgres;

    public JdbcSqlDialect(@Value("${spring.datasource.url:}") String jdbcUrl) {
        this.postgres = jdbcUrl != null && jdbcUrl.startsWith("jdbc:postgresql:");
    }

    public boolean isPostgres() {
        return postgres;
    }

    /**
     * INSERT notifications — colonne {@code data} : jsonb sur PostgreSQL, texte sur H2.
     */
    public String notificationInsertSql() {
        String dataParam = postgres ? "?::jsonb" : "?";
        return """
                INSERT INTO notifications (notif_id, user_id, type, title, body, data)
                VALUES (?, ?, ?, ?, ?, %s)
                """.formatted(dataParam);
    }
}
