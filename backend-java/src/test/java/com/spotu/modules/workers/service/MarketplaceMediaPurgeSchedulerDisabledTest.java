package com.spotu.modules.workers.service;

import com.spotu.modules.marketplace.service.ProductCreationService;
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
        "media.purge.worker.enabled=false",
        "media.purge.interval.secs=3600"
})
class MarketplaceMediaPurgeSchedulerDisabledTest {

    @Autowired
    private MarketplaceMediaPurgeScheduler scheduler;

    @MockBean
    private ProductCreationService productCreationService;

    @MockBean
    private MarketplaceFilePurgeService marketplaceFilePurgeService;

    @Test
    void startupAndPeriodic_disabled_doNothing() {
        scheduler.startupTick();
        scheduler.periodicTick();
        Mockito.verify(productCreationService, Mockito.never()).runMarketplaceMediaPurgeCycle();
        Mockito.verify(marketplaceFilePurgeService, Mockito.never()).runPurge(Mockito.anyInt());
    }
}
