package com.spotu.modules.auth.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.error.ApiAuthException;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.util.Collections;
import java.util.Map;

@Service
public class EmergentOAuthClient {

    private static final String EMERGENT_SESSION_URL =
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data";

    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper;

    public EmergentOAuthClient(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> fetchSession(String sessionId) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Session-ID", sessionId);
        try {
            ResponseEntity<String> response = restTemplate.exchange(
                    EMERGENT_SESSION_URL,
                    HttpMethod.GET,
                    new HttpEntity<>(headers),
                    String.class
            );
            Map<String, Object> body = parseBody(response.getBody());
            if (response.getStatusCode().value() != 200) {
                throw new ApiAuthException(stringOrDefault(body, "Invalid Google session"));
            }
            if (body.containsKey("error")) {
                throw new ApiAuthException(body.toString());
            }
            Object email = body.get("email");
            if (email == null || email.toString().isBlank()) {
                throw new ApiAuthException("Could not retrieve user email from Google");
            }
            return body;
        } catch (ApiAuthException e) {
            throw e;
        } catch (RestClientException e) {
            throw new ApiAuthException("Invalid Google session");
        }
    }

    private Map<String, Object> parseBody(String raw) {
        if (raw == null || raw.isBlank()) {
            return Collections.emptyMap();
        }
        try {
            return objectMapper.readValue(raw, new TypeReference<>() {
            });
        } catch (Exception e) {
            return Collections.emptyMap();
        }
    }

    private static String stringOrDefault(Map<String, Object> body, String fallback) {
        if (body == null || body.isEmpty()) {
            return fallback;
        }
        return body.toString();
    }
}
