package com.spotu.modules.workers.service;

import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = {
        "expiry.worker.enabled=true",
        "expiry.worker.interval.secs=3600"
})
class ExpiryWorkerSchedulerStartupTest {

    @Autowired
    private ExpiryWorkerScheduler expiryWorkerScheduler;

    @MockBean
    private ExpiryWorkerService expiryWorkerService;

    @Test
    void startupTick_runsImmediately() {
        Mockito.when(expiryWorkerService.drainExpiredBookings()).thenReturn(0);
        Mockito.verify(expiryWorkerService, Mockito.timeout(1000).atLeastOnce()).drainExpiredBookings();
    }
}
