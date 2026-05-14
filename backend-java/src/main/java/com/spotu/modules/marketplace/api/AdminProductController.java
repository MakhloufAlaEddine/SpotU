package com.spotu.modules.marketplace.api;

import com.spotu.modules.marketplace.dto.AdminPendingProductsResponseDto;
import com.spotu.modules.marketplace.service.AdminProductExceptions.AdminProductNotFoundError;
import com.spotu.modules.marketplace.service.AdminProductService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/admin/products")
public class AdminProductController {

    private final AdminProductService adminProductService;

    public AdminProductController(AdminProductService adminProductService) {
        this.adminProductService = adminProductService;
    }

    @GetMapping("/pending")
    public AdminPendingProductsResponseDto pending(HttpServletRequest request) {
        return adminProductService.pending(request);
    }

    @GetMapping("/{productId}")
    public Map<String, Object> detail(HttpServletRequest request, @PathVariable String productId) {
        return adminProductService.detail(request, productId);
    }

    @PostMapping("/{productId}/approve")
    public Map<String, Object> approve(
            HttpServletRequest request,
            @PathVariable String productId,
            @RequestBody(required = false) Map<String, Object> body
    ) {
        return adminProductService.approve(request, productId, body == null ? Map.of() : body);
    }

    @PostMapping("/{productId}/reject")
    public Map<String, Object> reject(
            HttpServletRequest request,
            @PathVariable String productId,
            @RequestBody(required = false) Map<String, Object> body
    ) {
        return adminProductService.reject(request, productId, body == null ? Map.of() : body);
    }

    @ExceptionHandler(AdminProductNotFoundError.class)
    public ResponseEntity<Map<String, Object>> handleNotFound(AdminProductNotFoundError ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of(
                "code", "PRODUCT_NOT_FOUND",
                "error", ex.getMessage()
        ));
    }
}
