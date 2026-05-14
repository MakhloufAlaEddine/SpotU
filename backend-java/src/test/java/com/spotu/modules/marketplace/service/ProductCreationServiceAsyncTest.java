package com.spotu.modules.marketplace.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.marketplace.infra.ProductCreationRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ProductCreationServiceAsyncTest {

    @Mock
    private AuthMeService authMeService;

    @Mock
    private ProductCreationRepository repository;

    @Mock
    private ObjectMapper objectMapper;

    @InjectMocks
    private ProductCreationService service;

    @Test
    void notifyAdminsPendingAsync_repositoryFailure_nonBlocking() {
        when(repository.findAdminUserIds()).thenThrow(new RuntimeException("db down"));

        assertDoesNotThrow(() -> service.notifyAdminsPendingAsync("prod_1", "Produit test"));
        verify(repository).findAdminUserIds();
        ProductCreationService.MetricsSnapshot snapshot = service.asyncMetricsSnapshot();
        org.junit.jupiter.api.Assertions.assertEquals(0, snapshot.attempted());
        org.junit.jupiter.api.Assertions.assertEquals(0, snapshot.success());
        org.junit.jupiter.api.Assertions.assertEquals(1, snapshot.failed());
        org.junit.jupiter.api.Assertions.assertEquals(0, snapshot.retryAttempted());
        org.junit.jupiter.api.Assertions.assertEquals(0, snapshot.invalidToken());
    }

    @Test
    void notifyAdminsPendingAsync_nominal_nonBlocking() {
        when(repository.findAdminUserIds()).thenReturn(List.of("admin_1", "admin_2"));

        assertDoesNotThrow(() -> service.notifyAdminsPendingAsync("prod_2", "Produit test 2"));
        verify(repository).findAdminUserIds();
        ProductCreationService.MetricsSnapshot snapshot = service.asyncMetricsSnapshot();
        org.junit.jupiter.api.Assertions.assertEquals(2, snapshot.attempted());
        org.junit.jupiter.api.Assertions.assertEquals(2, snapshot.success());
        org.junit.jupiter.api.Assertions.assertEquals(0, snapshot.failed());
        org.junit.jupiter.api.Assertions.assertEquals(0, snapshot.retryAttempted());
        org.junit.jupiter.api.Assertions.assertEquals(0, snapshot.invalidToken());
    }
}
