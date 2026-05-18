package com.spotu.common;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JdbcSqlDialectTest {

    @Test
    void notificationInsertSql_postgres_castsDataToJsonb() {
        var dialect = new JdbcSqlDialect("jdbc:postgresql://localhost:5432/postgres");
        assertTrue(dialect.isPostgres());
        assertTrue(dialect.notificationInsertSql().contains("?::jsonb"));
    }

    @Test
    void notificationInsertSql_h2_usesPlainPlaceholder() {
        var dialect = new JdbcSqlDialect("jdbc:h2:mem:test");
        assertFalse(dialect.isPostgres());
        assertFalse(dialect.notificationInsertSql().contains("::jsonb"));
    }
}
