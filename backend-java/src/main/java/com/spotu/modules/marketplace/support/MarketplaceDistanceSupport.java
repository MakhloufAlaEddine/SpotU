package com.spotu.modules.marketplace.support;

import java.util.Locale;

public final class MarketplaceDistanceSupport {

    private static final double EARTH_RADIUS_KM = 6371.0;

    private MarketplaceDistanceSupport() {
    }

    public static double haversineKm(double lat1, double lon1, double lat2, double lon2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.pow(Math.sin(dLat / 2.0), 2.0)
                + Math.cos(Math.toRadians(lat1))
                * Math.cos(Math.toRadians(lat2))
                * Math.pow(Math.sin(dLon / 2.0), 2.0);
        double km = EARTH_RADIUS_KM * 2.0 * Math.asin(Math.sqrt(a));
        return Math.round(km * 10.0) / 10.0;
    }

    public static String fmtDist(double km) {
        if (km < 1.0) {
            return (int) (km * 1000.0) + " m";
        }
        return String.format(Locale.ROOT, "%.1f km", km);
    }
}
