package com.spotu.modules.workers.service;

import com.spotu.modules.marketplace.service.ProductCreationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class MarketplaceMediaPurgeScheduler {

    private static final Logger log = LoggerFactory.getLogger(MarketplaceMediaPurgeScheduler.class);

    private final ProductCreationService productCreationService;
    private final MarketplaceFilePurgeService marketplaceFilePurgeService;

    @Value("${media.purge.worker.enabled:true}")
    private boolean enabled;

    public MarketplaceMediaPurgeScheduler(
            ProductCreationService productCreationService,
            MarketplaceFilePurgeService marketplaceFilePurgeService
    ) {
        this.productCreationService = productCreationService;
        this.marketplaceFilePurgeService = marketplaceFilePurgeService;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void startupTick() {
        if (!enabled) {
            return;
        }
        runOneTick("startup");
    }

    @Scheduled(
            fixedDelayString = "${media.purge.interval.secs:3600}000",
            initialDelayString = "${media.purge.interval.secs:3600}000"
    )
    public void periodicTick() {
        if (!enabled) {
            return;
        }
        runOneTick("periodic");
    }

    void runOneTick(String source) {
        try {
            int purged = productCreationService.runMarketplaceMediaPurgeCycle();
            if (purged > 0) {
                log.info("[PURGE-MEDIA] {} tick: {} produit(s) marqué(s) purgés", source, purged);
                try {
                    marketplaceFilePurgeService.runPurge(0);
                } catch (Exception exc) {
                    log.warn("[PURGE-MEDIA] run_purge() a échoué : {}", exc.getMessage());
                }
            }
        } catch (Exception exc) {
            log.error("[PURGE-MEDIA] {} tick: erreur inattendue", source, exc);
        }
    }
}
