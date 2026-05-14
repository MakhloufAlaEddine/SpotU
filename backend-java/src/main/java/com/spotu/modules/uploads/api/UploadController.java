package com.spotu.modules.uploads.api;

import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.uploads.service.UploadService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class UploadController {

    private final AuthMeService authMeService;
    private final UploadService uploadService;

    public UploadController(AuthMeService authMeService, UploadService uploadService) {
        this.authMeService = authMeService;
        this.uploadService = uploadService;
    }

    @PostMapping(value = "/upload-image", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> uploadImage(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "category", required = false, defaultValue = "other") String category,
            HttpServletRequest request
    ) {
        return uploadService.uploadImage(authMeService.requireCurrentUser(request), file, category, request);
    }

    @PostMapping(value = "/upload-image/debug-422")
    public Map<String, Object> debug422(HttpServletRequest request, @RequestBody(required = false) byte[] body) {
        return uploadService.debug422(request, body);
    }
}

