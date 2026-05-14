package com.spotu.modules.marketplace.api;

import com.spotu.error.ApiForbiddenException;
import com.spotu.modules.marketplace.dto.ProductMineResponseDto;
import com.spotu.modules.marketplace.dto.ProductUpsertResponseDto;
import com.spotu.modules.marketplace.service.ProductCreationService;
import com.spotu.modules.marketplace.service.ProductCreationExceptions.ProductBadRequestError;
import com.spotu.modules.marketplace.service.ProductCreationExceptions.ProductDeleteNotFoundError;
import com.spotu.modules.marketplace.service.ProductCreationExceptions.ProductNotFoundError;
import com.spotu.modules.marketplace.service.ProductCreationExceptions.ProductValidation422Error;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/products")
public class ProductCreationController {

    private final ProductCreationService productCreationService;

    public ProductCreationController(ProductCreationService productCreationService) {
        this.productCreationService = productCreationService;
    }

    @PostMapping
    public ProductUpsertResponseDto upsertProduct(
            @RequestBody(required = false) Map<String, Object> body,
            HttpServletRequest request
    ) {
        return productCreationService.upsert(body == null ? Map.of() : body, request);
    }

    @GetMapping("/mine")
    public ProductMineResponseDto myProducts(HttpServletRequest request) {
        return productCreationService.mine(request);
    }

    @GetMapping("/{productId}/detail")
    public Map<String, Object> productDetail(@PathVariable String productId, HttpServletRequest request) {
        return productCreationService.detail(productId, request);
    }

    @DeleteMapping("/{productId}")
    public Map<String, Object> deleteProduct(@PathVariable String productId, HttpServletRequest request) {
        return productCreationService.deleteProduct(productId, request);
    }

    @PostMapping("/{productId}/reactivate")
    public Map<String, Object> reactivateProduct(@PathVariable String productId, HttpServletRequest request) {
        return productCreationService.reactivateProduct(productId, request);
    }

    @ExceptionHandler(ProductBadRequestError.class)
    public ResponseEntity<Map<String, Object>> handleBadRequest(ProductBadRequestError ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                "code", "PRODUCT_BAD_REQUEST",
                "error", ex.getMessage()
        ));
    }

    @ExceptionHandler(ProductValidation422Error.class)
    public ResponseEntity<Map<String, Object>> handleValidation422(ProductValidation422Error ex) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("code", "PRODUCT_VALIDATION_ERROR");
        out.put("error", ex.getMessage());
        out.put("details", ex.details());
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(out);
    }

    @ExceptionHandler(ProductNotFoundError.class)
    public ResponseEntity<Map<String, Object>> handleNotFound(ProductNotFoundError ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of(
                "code", "PRODUCT_NOT_FOUND",
                "error", ex.getMessage()
        ));
    }

    @ExceptionHandler(ProductDeleteNotFoundError.class)
    public ResponseEntity<Map<String, Object>> handleDeleteNotFound(ProductDeleteNotFoundError ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of(
                "code", "PRODUCT_NOT_FOUND",
                "error", ex.getMessage()
        ));
    }

    @ExceptionHandler(ApiForbiddenException.class)
    public ResponseEntity<Map<String, Object>> handleForbidden(ApiForbiddenException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                "code", "FORBIDDEN",
                "detail", ex.getDetail()
        ));
    }
}
