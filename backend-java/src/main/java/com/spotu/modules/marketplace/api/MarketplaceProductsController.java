package com.spotu.modules.marketplace.api;

import com.spotu.modules.marketplace.dto.MarketplaceProductsResponseDto;
import com.spotu.modules.marketplace.service.MarketplaceProductsService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/marketplace")
public class MarketplaceProductsController {

    private final MarketplaceProductsService marketplaceProductsService;

    public MarketplaceProductsController(MarketplaceProductsService marketplaceProductsService) {
        this.marketplaceProductsService = marketplaceProductsService;
    }

    @GetMapping("/products")
    public MarketplaceProductsResponseDto getProducts(
            @RequestParam(value = "tag_ids", required = false) String tagIds,
            @RequestParam(value = "spotyou_id", required = false) String spotyouId,
            @RequestParam(value = "user_lat", required = false) Double userLat,
            @RequestParam(value = "user_lng", required = false) Double userLng
    ) {
        return marketplaceProductsService.getProducts(tagIds, spotyouId, userLat, userLng);
    }
}
