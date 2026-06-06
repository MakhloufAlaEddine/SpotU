package com.spotu.modules.marketplace.service;

import com.spotu.error.ApiForbiddenException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.marketplace.dto.AdminPendingProductsResponseDto;
import com.spotu.modules.marketplace.infra.AdminProductRepository;
import com.spotu.modules.spotyou.service.SpotYouPushSideEffectService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import static com.spotu.modules.marketplace.service.AdminProductExceptions.AdminProductNotFoundError;

@Service
public class AdminProductService {

    private final AuthMeService authMeService;
    private final AdminProductRepository repository;
    private final SpotYouPushSideEffectService pushSideEffectService;
    private final int reminderDelayHours;

    public AdminProductService(
            AuthMeService authMeService,
            AdminProductRepository repository,
            SpotYouPushSideEffectService pushSideEffectService,
            @Value("${admin.product.reminder.delay.hours:2}") int reminderDelayHours
    ) {
        this.authMeService = authMeService;
        this.repository = repository;
        this.pushSideEffectService = pushSideEffectService;
        this.reminderDelayHours = reminderDelayHours;
    }

    public AdminPendingProductsResponseDto pending(HttpServletRequest request) {
        requireAdmin(request);
        List<Map<String, Object>> rows = repository.findPendingProducts();
        return new AdminPendingProductsResponseDto(rows, rows.size());
    }

    public Map<String, Object> detail(HttpServletRequest request, String productId) {
        requireAdmin(request);
        return repository.findAdminDetail(productId)
                .orElseThrow(() -> new AdminProductNotFoundError("Produit introuvable."));
    }

    @Transactional
    public Map<String, Object> approve(HttpServletRequest request, String productId, Map<String, Object> body) {
        CurrentUserDto admin = requireAdmin(request);
        String comment = parseCommentForDb(body);
        Map<String, String> row = repository.findSellerAndTitle(productId)
                .orElseThrow(() -> new AdminProductNotFoundError("Produit introuvable."));
        String sellerId = row.get("seller_id");
        String title = row.get("title");

        Timestamp now = Timestamp.from(Instant.now());
        repository.approveProduct(productId, admin.userId(), now, comment);
        pushSideEffectService.persistAndPush(
                sellerId,
                "product_approved",
                "Produit publié !",
                "Ton annonce « " + title + " » a été validée et est maintenant visible dans la boutique.",
                Map.of(
                        "type", "product_approved",
                        "product_id", productId,
                        "action", "/products/my-products"
                )
        );
        return Map.of("ok", true, "status", "active");
    }

    @Transactional
    public Map<String, Object> reject(HttpServletRequest request, String productId, Map<String, Object> body) {
        CurrentUserDto admin = requireAdmin(request);
        String commentDb = parseCommentForDb(body);
        String commentPush = parseCommentForPush(body);
        Map<String, String> row = repository.findSellerAndTitle(productId)
                .orElseThrow(() -> new AdminProductNotFoundError("Produit introuvable."));
        String sellerId = row.get("seller_id");
        String title = row.get("title");

        Timestamp now = Timestamp.from(Instant.now());
        repository.rejectProduct(productId, admin.userId(), now, commentDb);
        pushSideEffectService.persistAndPush(
                sellerId,
                "product_rejected",
                "Annonce refusée",
                "Ton annonce « " + title + " » n'a pas été validée. Clique pour voir les corrections à apporter.",
                Map.of(
                        "type", "product_rejected",
                        "product_id", productId,
                        "admin_comment", commentPush,
                        "action", "/products/create?productId=" + productId + "&mode=edit"
                )
        );
        return Map.of("ok", true, "status", "rejected");
    }

    @Transactional
    public int runReminderCycle() {
        List<Map<String, String>> products = repository.findPendingReminderProducts(reminderDelayHours);
        if (products.isEmpty()) {
            return 0;
        }
        List<String> adminIds = repository.findAdminUserIds();
        if (adminIds.isEmpty()) {
            return 0;
        }

        Timestamp now = Timestamp.from(Instant.now());
        List<String> productIds = products.stream().map(p -> p.get("product_id")).toList();
        repository.markReminderSent(productIds, now);

        for (Map<String, String> product : products) {
            String productId = product.get("product_id");
            String title = product.get("title");
            for (String adminId : adminIds) {
                pushSideEffectService.persistAndPush(
                        adminId,
                        "admin_product_reminder",
                        "Rappel : annonce en attente",
                        "L'annonce « " + title + " » attend votre validation depuis " + reminderDelayHours + "h.",
                        Map.of(
                                "type", "admin_product_reminder",
                                "product_id", productId,
                                "action", "/admin?tab=products"
                        )
                );
            }
        }
        return products.size();
    }

    private CurrentUserDto requireAdmin(HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        if (!"admin".equals(user.role())) {
            throw new ApiForbiddenException("Admin only");
        }
        return user;
    }

    private String parseCommentForDb(Map<String, Object> body) {
        Object v = body == null ? null : body.get("comment");
        String comment = v == null ? "" : String.valueOf(v).strip();
        return comment.isEmpty() ? null : comment;
    }

    private String parseCommentForPush(Map<String, Object> body) {
        Object v = body == null ? null : body.get("comment");
        return v == null ? "" : String.valueOf(v).strip();
    }
}
