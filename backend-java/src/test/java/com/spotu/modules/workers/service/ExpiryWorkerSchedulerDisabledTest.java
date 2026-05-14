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
        "expiry.worker.enabled=false",
        "expiry.worker.interval.secs=60"
})
class ExpiryWorkerSchedulerDisabledTest {

    @Autowired
    private ExpiryWorkerScheduler expiryWorkerScheduler;

    @MockBean
    private ExpiryWorkerService expiryWorkerService;

    @Test
    void startupAndPeriodic_disabled_doNothing() {
        expiryWorkerScheduler.startupTick();
        expiryWorkerScheduler.periodicTick();
        Mockito.verify(expiryWorkerService, Mockito.never()).drainExpiredBookings();
    }
}
