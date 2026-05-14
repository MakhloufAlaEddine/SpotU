package com.spotu.modules.workers.service;

import com.spotu.modules.marketplace.service.AdminProductService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class AdminProductReminderScheduler {

    private static final Logger log = LoggerFactory.getLogger(AdminProductReminderScheduler.class);

    private final AdminProductService adminProductService;

    @Value("${admin.product.reminder.enabled:true}")
    private boolean enabled;

    public AdminProductReminderScheduler(AdminProductService adminProductService) {
        this.adminProductService = adminProductService;
    }

    @Scheduled(
            fixedDelayString = "${admin.product.reminder.interval.secs:600}000",
            initialDelayString = "${admin.product.reminder.interval.secs:600}000"
    )
    public void periodicTick() {
        if (!enabled) {
            return;
        }
        try {
            int count = adminProductService.runReminderCycle();
            if (count > 0) {
                log.info("AdminProductReminderWorker: {} rappel(s) envoyé(s).", count);
            }
        } catch (Exception e) {
            log.error("AdminProductReminderWorker erreur: {}", e.getMessage(), e);
        }
    }
}
