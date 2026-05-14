package com.spotu.modules.uploads.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@Service
public class FileStorageService {

    private static final Logger log = LoggerFactory.getLogger(FileStorageService.class);
    private static final int MAX_DIM = 2000;
    private static final Set<String> R2_FOLDERS = Set.of("profiles", "services", "spotyou", "chats", "products", "other");

    @Value("${app.uploads.local-dir:/app/backend/uploads}")
    private String localDir;

    @Value("${r2.public-url:}")
    private String r2PublicUrl;

    @Value("${r2.bucket-name:}")
    private String r2BucketName;

    @Value("${r2.endpoint:}")
    private String r2Endpoint;

    @Value("${r2.access-key-id:}")
    private String r2AccessKeyId;

    @Value("${r2.secret-access-key:}")
    private String r2SecretAccessKey;

    private volatile S3Client s3Client;

    public UploadResult uploadWithFallback(byte[] content, String folder, String ext, String baseUrl) {
        String safeFolder = R2_FOLDERS.contains(folder) ? folder : "other";
        String filename = "img_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16) + "." + ext;
        byte[] compressed = compress(content, ext);

        if (isR2Configured()) {
            try {
                String key = safeFolder + "/" + filename;
                r2Client().putObject(
                        PutObjectRequest.builder()
                                .bucket(r2BucketName)
                                .key(key)
                                .contentType(contentType(ext))
                                .cacheControl("public, max-age=31536000")
                                .build(),
                        RequestBody.fromBytes(compressed)
                );
                String url = trimmedR2PublicUrl() + "/" + key;
                return new UploadResult(url, filename);
            } catch (Exception e) {
                log.error("R2 upload failed: {} — fallback filesystem", e.getMessage());
            }
        }

        Path dir = Path.of(localDir);
        try {
            java.nio.file.Files.createDirectories(dir);
            java.nio.file.Files.write(dir.resolve(filename), compressed);
        } catch (IOException e) {
            throw new RuntimeException("Upload failed");
        }
        String url = baseUrl + "/api/uploads/" + filename;
        return new UploadResult(url, filename);
    }

    public void deleteUploadFile(String url) {
        if (url == null || url.isBlank()) {
            return;
        }
        String trimmedR2 = r2PublicUrl == null ? "" : r2PublicUrl.replaceAll("/+$", "");
        if (!trimmedR2.isBlank() && url.startsWith(trimmedR2)) {
            try {
                String key = url.substring(trimmedR2.length()).replaceAll("^/+", "");
                if (!key.isBlank()) {
                    r2Client().deleteObject(
                            DeleteObjectRequest.builder().bucket(r2BucketName).key(key).build()
                    );
                }
            } catch (Exception e) {
                log.warn("R2 delete failed: {}", e.getMessage());
            }
            return;
        }
        if (!url.contains("/api/uploads/")) {
            return;
        }
        String filename = url.substring(url.lastIndexOf("/api/uploads/") + "/api/uploads/".length()).split("\\?")[0];
        try {
            Path root = Path.of(localDir).toRealPath();
            Path file = root.resolve(filename).normalize();
            if (!file.startsWith(root)) {
                log.warn("[SEC-10] Path traversal bloqué: {}", filename);
                return;
            }
            java.nio.file.Files.deleteIfExists(file);
        } catch (Exception e) {
            log.warn("Local delete failed {}: {}", filename, e.getMessage());
        }
    }

    public String normalizeCategory(String category) {
        if (category == null) {
            return "other";
        }
        String c = category.toLowerCase(Locale.ROOT);
        return R2_FOLDERS.contains(c) ? c : "other";
    }

    private boolean isR2Configured() {
        return notBlank(r2PublicUrl) && notBlank(r2BucketName) && notBlank(r2Endpoint)
                && notBlank(r2AccessKeyId) && notBlank(r2SecretAccessKey);
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }

    private String trimmedR2PublicUrl() {
        return r2PublicUrl.replaceAll("/+$", "");
    }

    private synchronized S3Client r2Client() {
        if (s3Client != null) {
            return s3Client;
        }
        s3Client = S3Client.builder()
                .endpointOverride(URI.create(r2Endpoint))
                .region(Region.of("auto"))
                .credentialsProvider(
                        StaticCredentialsProvider.create(
                                AwsBasicCredentials.create(r2AccessKeyId, r2SecretAccessKey)
                        )
                )
                .build();
        return s3Client;
    }

    private static String contentType(String ext) {
        return switch (ext.toLowerCase(Locale.ROOT)) {
            case "jpg", "jpeg" -> "image/jpeg";
            case "png" -> "image/png";
            case "gif" -> "image/gif";
            case "webp" -> "image/webp";
            case "heic" -> "image/heic";
            default -> "application/octet-stream";
        };
    }

    private static byte[] compress(byte[] data, String ext) {
        if ("gif".equalsIgnoreCase(ext) || "heic".equalsIgnoreCase(ext)) {
            return data;
        }
        try {
            BufferedImage image = ImageIO.read(new ByteArrayInputStream(data));
            if (image == null) {
                return data;
            }
            int w = image.getWidth();
            int h = image.getHeight();
            if (Math.max(w, h) > MAX_DIM) {
                double ratio = (double) MAX_DIM / Math.max(w, h);
                int nw = (int) Math.round(w * ratio);
                int nh = (int) Math.round(h * ratio);
                java.awt.Image scaled = image.getScaledInstance(nw, nh, java.awt.Image.SCALE_SMOOTH);
                BufferedImage resized = new BufferedImage(nw, nh, BufferedImage.TYPE_INT_RGB);
                java.awt.Graphics2D g = resized.createGraphics();
                g.drawImage(scaled, 0, 0, null);
                g.dispose();
                image = resized;
            }
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            String outFormat = "png".equalsIgnoreCase(ext) ? "png" : "jpg";
            ImageIO.write(image, outFormat, baos);
            return baos.toByteArray();
        } catch (Exception e) {
            return data;
        }
    }

    public record UploadResult(String url, String filename) {
    }
}

