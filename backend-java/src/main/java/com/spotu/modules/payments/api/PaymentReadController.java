package com.spotu.modules.payments.api;

import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.payments.service.PaymentReadService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/payments")
public class PaymentReadController {

    private final AuthMeService authMeService;
    private final PaymentReadService paymentReadService;

    public PaymentReadController(AuthMeService authMeService, PaymentReadService paymentReadService) {
        this.authMeService = authMeService;
        this.paymentReadService = paymentReadService;
    }

    @GetMapping("/me")
    public ResponseEntity<List<Map<String, Object>>> myPayments(HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        return ResponseEntity.ok(paymentReadService.getMyPayments(user.userId()));
    }

    @GetMapping("/{paymentId}")
    public ResponseEntity<Map<String, Object>> getPayment(@PathVariable String paymentId, HttpServletRequest request) {
        CurrentUserDto user = authMeService.requireCurrentUser(request);
        return ResponseEntity.ok(paymentReadService.getPaymentById(paymentId, user.userId(), user.role()));
    }
}
