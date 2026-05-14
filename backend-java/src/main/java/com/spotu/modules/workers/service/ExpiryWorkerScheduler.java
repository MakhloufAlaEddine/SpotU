package com.spotu.modules.workers.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class ExpiryWorkerScheduler {

    private static final Logger log = LoggerFactory.getLogger(ExpiryWorkerScheduler.class);

    private final ExpiryWorkerService expiryWorkerService;

    @Value("${expiry.worker.enabled:true}")
    private boolean enabled;

    public ExpiryWorkerScheduler(ExpiryWorkerService expiryWorkerService) {
        this.expiryWorkerService = expiryWorkerService;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void startupTick() {
        if (!enabled) {
            return;
        }
        runOneTick("startup");
    }

    @Scheduled(
            fixedDelayString = "${expiry.worker.interval.secs:60}000",
            initialDelayString = "${expiry.worker.interval.secs:60}000"
    )
    public void periodicTick() {
        if (!enabled) {
            return;
        }
        runOneTick("periodic");
    }

    void runOneTick(String source) {
        try {
            int total = expiryWorkerService.drainExpiredBookings();
            if (total > 0) {
                log.info("ExpiryWorker {} tick: {} booking(s) expiré(s)", source, total);
            }
        } catch (Exception exc) {
            log.error("ExpiryWorker {} tick: erreur inattendue", source, exc);
        }
    }
}
