package com.spotu.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;

/**
 * CORS piloté par propriétés, aligné sur le backend Python :
 * liste explicite d'origines + credentials autorisés, sans wildcard permissif.
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Value("${app.cors.allowed-origins:http://localhost:3000,http://localhost:19006,http://localhost:8081}")
    private String allowedOriginsRaw;

    @Value("${app.uploads.local-dir:/app/backend/uploads}")
    private String uploadsLocalDir;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        List<String> allowedOrigins = Arrays.stream(allowedOriginsRaw.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
        registry.addMapping("/api/**")
                .allowedOrigins(allowedOrigins.toArray(new String[0]))
                .allowCredentials(true)
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("Authorization", "Content-Type");
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        String location = Path.of(uploadsLocalDir).toAbsolutePath().normalize().toUri().toString();
        registry.addResourceHandler("/api/uploads/**")
                .addResourceLocations(location.endsWith("/") ? location : location + "/");
    }
}
