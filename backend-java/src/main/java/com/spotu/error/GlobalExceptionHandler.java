package com.spotu.error;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.LinkedHashMap;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /**
     * Même enveloppe que FastAPI : {@code {"detail": "..."}}.
     */
    @ExceptionHandler(ApiAuthException.class)
    public ResponseEntity<Map<String, String>> handleApiAuth(ApiAuthException ex, HttpServletRequest request) {
        log.debug("Auth error on {}: {}", request.getRequestURI(), ex.getDetail());
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(detailBody("AUTH_ERROR", ex.getDetail()));
    }

    @ExceptionHandler(ApiBadRequestException.class)
    public ResponseEntity<Map<String, String>> handleApiBadRequest(ApiBadRequestException ex, HttpServletRequest request) {
        log.debug("Bad request on {}: {}", request.getRequestURI(), ex.getDetail());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(detailBody("BAD_REQUEST", ex.getDetail()));
    }

    @ExceptionHandler(ApiNotFoundException.class)
    public ResponseEntity<Map<String, String>> handleApiNotFound(ApiNotFoundException ex, HttpServletRequest request) {
        log.debug("Not found on {}: {}", request.getRequestURI(), ex.getDetail());
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(detailBody("NOT_FOUND", ex.getDetail()));
    }

    @ExceptionHandler(ApiForbiddenException.class)
    public ResponseEntity<Map<String, String>> handleApiForbidden(ApiForbiddenException ex, HttpServletRequest request) {
        log.debug("Forbidden on {}: {}", request.getRequestURI(), ex.getDetail());
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(detailBody("FORBIDDEN", ex.getDetail()));
    }

    @ExceptionHandler(ApiConflictException.class)
    public ResponseEntity<Map<String, String>> handleApiConflict(ApiConflictException ex, HttpServletRequest request) {
        log.debug("Conflict on {}: {}", request.getRequestURI(), ex.getDetail());
        return ResponseEntity.status(HttpStatus.CONFLICT).body(detailBody("CONFLICT", ex.getDetail()));
    }

    @ExceptionHandler(ApiTooManyRequestsException.class)
    public ResponseEntity<Map<String, String>> handleTooManyRequests(
            ApiTooManyRequestsException ex,
            HttpServletRequest request
    ) {
        log.debug("Rate limit on {}: {}", request.getRequestURI(), ex.getDetail());
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(detailBody("TOO_MANY_REQUESTS", ex.getDetail()));
    }

    @ExceptionHandler(ApiGoneException.class)
    public ResponseEntity<Map<String, String>> handleApiGone(ApiGoneException ex, HttpServletRequest request) {
        log.debug("Gone on {}: {}", request.getRequestURI(), ex.getDetail());
        return ResponseEntity.status(HttpStatus.GONE).body(detailBody("GONE", ex.getDetail()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(
            MethodArgumentNotValidException ex,
            HttpServletRequest request) {
        Map<String, String> fields = new LinkedHashMap<>();
        ex.getBindingResult().getFieldErrors()
                .forEach(fe -> fields.put(fe.getField(), fe.getDefaultMessage()));
        var body = new ErrorResponse(
                "VALIDATION_ERROR",
                java.time.Instant.now(),
                HttpStatus.BAD_REQUEST.value(),
                HttpStatus.BAD_REQUEST.getReasonPhrase(),
                "Validation failed",
                request.getRequestURI(),
                fields
        );
        log.warn("Validation error on {}: {}", request.getRequestURI(), fields);
        return ResponseEntity.badRequest().body(body);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ErrorResponse> handleConstraint(
            ConstraintViolationException ex,
            HttpServletRequest request) {
        log.warn("Constraint violation: {}", ex.getMessage());
        return ResponseEntity.badRequest().body(
                ErrorResponse.of(
                        "CONSTRAINT_VIOLATION",
                        HttpStatus.BAD_REQUEST.value(),
                        HttpStatus.BAD_REQUEST.getReasonPhrase(),
                        ex.getMessage(),
                        request.getRequestURI()
                )
        );
    }

    /**
     * Base de données indisponible ou erreur SQL — réponse 503 (analogie readiness Python, pas de 500 générique).
     */
    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<ErrorResponse> handleDataAccess(DataAccessException ex, HttpServletRequest request) {
        log.error("Data access error on {}", request.getRequestURI(), ex);
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(
                ErrorResponse.of(
                        "DATABASE_ERROR",
                        HttpStatus.SERVICE_UNAVAILABLE.value(),
                        HttpStatus.SERVICE_UNAVAILABLE.getReasonPhrase(),
                        "Database error",
                        request.getRequestURI()
                )
        );
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGeneric(Exception ex, HttpServletRequest request) {
        log.error("Unhandled error on {}", request.getRequestURI(), ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                ErrorResponse.of(
                        "INTERNAL_ERROR",
                        HttpStatus.INTERNAL_SERVER_ERROR.value(),
                        HttpStatus.INTERNAL_SERVER_ERROR.getReasonPhrase(),
                        "Internal error",
                        request.getRequestURI()
                )
        );
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, String>> handleResponseStatusException(
            ResponseStatusException ex,
            HttpServletRequest request
    ) {
        String detail = ex.getReason() == null ? ex.getMessage() : ex.getReason();
        log.debug("ResponseStatusException on {}: {}", request.getRequestURI(), detail);
        return ResponseEntity.status(ex.getStatusCode()).body(detailBody("RESPONSE_STATUS", detail));
    }

    private Map<String, String> detailBody(String code, String detail) {
        Map<String, String> out = new LinkedHashMap<>();
        out.put("code", code);
        out.put("detail", detail);
        return out;
    }
}
