package com.spotu.modules.uploads.service;

import com.spotu.error.ApiBadRequestException;
import com.spotu.error.ApiNotFoundException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class UploadService {

    private static final int MAX_UPLOAD_SIZE = 15 * 1024 * 1024;
    private final FileStorageService fileStorageService;

    public UploadService(FileStorageService fileStorageService) {
        this.fileStorageService = fileStorageService;
    }

    public Map<String, Object> uploadImage(
            CurrentUserDto ignored,
            MultipartFile file,
            String category,
            HttpServletRequest request
    ) {
        byte[] content;
        try {
            content = file.getBytes();
        } catch (Exception e) {
            throw new ApiBadRequestException("Upload invalide");
        }
        if (content.length > MAX_UPLOAD_SIZE) {
            throw new ResponseStatusException(
                    HttpStatus.PAYLOAD_TOO_LARGE,
                    "Fichier trop volumineux (max 15 Mo)"
            );
        }

        String imgType = detectImageType(content);
        if (imgType == null) {
            throw new ResponseStatusException(
                    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
                    "Type de fichier non supporté. Formats acceptés : JPEG, PNG, WebP, GIF, HEIC"
            );
        }
        String extension = switch (imgType) {
            case "jpeg" -> "jpg";
            case "png" -> "png";
            case "gif" -> "gif";
            case "webp" -> "webp";
            case "heic" -> "heic";
            default -> throw new ApiNotFoundException("Unsupported image");
        };

        String folder = fileStorageService.normalizeCategory(category);
        String baseUrl = computeBaseUrl(request);
        FileStorageService.UploadResult r = fileStorageService.uploadWithFallback(content, folder, extension, baseUrl);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("url", r.url());
        out.put("filename", r.filename());
        return out;
    }

    public Map<String, Object> debug422(HttpServletRequest request, byte[] body) {
        Map<String, Object> out = new LinkedHashMap<>();
        String ct = request.getContentType() == null ? "" : request.getContentType();
        out.put("content_type", ct);
        out.put("body_len", body == null ? 0 : body.length);
        out.put("body_start", hex(body == null ? new byte[0] : body, 100));
        return out;
    }

    private static String computeBaseUrl(HttpServletRequest request) {
        String host = request.getHeader("x-forwarded-host");
        String proto = request.getHeader("x-forwarded-proto");
        if (host != null && !host.isBlank()) {
            return ((proto == null || proto.isBlank()) ? "https" : proto) + "://" + host;
        }
        return request.getScheme() + "://" + request.getServerName()
                + ((request.getServerPort() == 80 || request.getServerPort() == 443) ? "" : ":" + request.getServerPort());
    }

    static String detectImageType(byte[] data) {
        if (data == null || data.length < 12) {
            return null;
        }
        if (startsWith(data, new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF})) {
            return "jpeg";
        }
        if (startsWith(data, new byte[]{(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'})) {
            return "png";
        }
        if (startsWith(data, "GIF87a".getBytes()) || startsWith(data, "GIF89a".getBytes())) {
            return "gif";
        }
        if (startsWith(data, "RIFF".getBytes()) && at(data, 8, "WEBP".getBytes())) {
            return "webp";
        }
        if (at(data, 4, "ftyp".getBytes())) {
            byte[] brand = new byte[]{data[8], data[9], data[10]};
            String s = new String(brand);
            if ("hei".equals(s) || "hev".equals(s) || "mif".equals(s) || "msf".equals(s) || "avi".equals(s)) {
                return "heic";
            }
        }
        return null;
    }

    private static boolean startsWith(byte[] data, byte[] sig) {
        if (data.length < sig.length) {
            return false;
        }
        for (int i = 0; i < sig.length; i++) {
            if (data[i] != sig[i]) {
                return false;
            }
        }
        return true;
    }

    private static boolean at(byte[] data, int offset, byte[] sig) {
        if (data.length < offset + sig.length) {
            return false;
        }
        for (int i = 0; i < sig.length; i++) {
            if (data[offset + i] != sig[i]) {
                return false;
            }
        }
        return true;
    }

    private static String hex(byte[] data, int maxBytes) {
        int n = Math.min(data.length, maxBytes);
        StringBuilder sb = new StringBuilder(n * 2);
        for (int i = 0; i < n; i++) {
            sb.append(String.format("%02x", data[i]));
        }
        return sb.toString();
    }
}

