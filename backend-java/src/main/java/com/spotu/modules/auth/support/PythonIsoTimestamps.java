package com.spotu.modules.auth.support;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;

/**
 * Aligné sur {@code datetime.isoformat()} Python (UTC, microsecondes, offset {@code +00:00}, pas {@code Z}).
 */
public final class PythonIsoTimestamps {

    private static final DateTimeFormatter FORMATTER =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSSSSxxx");

    private PythonIsoTimestamps() {
    }

    public static String fromTimestamp(Timestamp ts) {
        if (ts == null) {
            return null;
        }
        Instant instant = ts.toInstant();
        OffsetDateTime odt = instant.atOffset(ZoneOffset.UTC).truncatedTo(ChronoUnit.MICROS);
        return odt.format(FORMATTER);
    }
}
