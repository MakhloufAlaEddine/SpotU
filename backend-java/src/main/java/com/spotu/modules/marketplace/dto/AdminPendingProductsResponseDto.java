package com.spotu.modules.marketplace.dto;

import java.util.List;
import java.util.Map;

public record AdminPendingProductsResponseDto(
        List<Map<String, Object>> products,
        int count
) {
}
