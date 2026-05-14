package com.spotu.modules.uploads.api;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = {
        "app.uploads.local-dir=target/test-uploads-static"
})
class UploadsStaticServingIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    private final Path uploadsDir = Path.of("target/test-uploads-static");

    @AfterEach
    void cleanup() throws Exception {
        if (Files.exists(uploadsDir)) {
            Files.walk(uploadsDir)
                    .sorted((a, b) -> b.getNameCount() - a.getNameCount())
                    .forEach(p -> {
                        try {
                            Files.deleteIfExists(p);
                        } catch (Exception ignored) {
                        }
                    });
        }
    }

    @Test
    void servesStaticFileFromConfiguredUploadsDirectory() throws Exception {
        Files.createDirectories(uploadsDir);
        String filename = "static_test_file.txt";
        Path file = uploadsDir.resolve(filename);
        Files.writeString(file, "hello-uploads", StandardCharsets.UTF_8);

        mockMvc.perform(get("/api/uploads/" + filename))
                .andExpect(status().isOk())
                .andExpect(content().string("hello-uploads"));
    }
}
