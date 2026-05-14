package com.spotu.modules.spotyou.support;

import java.util.Random;

/**
 * Équivalent de {@code randomize_for_storage} dans {@code tagpoint_routes.py} (l.118–143).
 * <p>
 * Décalage <strong>non déterministe</strong> (nouveau {@link Random} à chaque appel — pas de seed).
 * À ne pas confondre avec {@link TagPointResponseBuilder#applyPrecisionOffset} (lecture, seed optionnel).
 */
public final class GeoRandomizer {

    private GeoRandomizer() {
    }

    public static double[] randomizeForStorage(double lat, double lng, String precision) {
        String p = precision == null ? "exact" : precision;
        if ("exact".equals(p)) {
            return new double[]{lat, lng};
        }
        int radiusM;
        if ("100m".equals(p)) {
            radiusM = 100;
        } else if ("1000m".equals(p)) {
            radiusM = 1000;
        } else {
            return new double[]{lat, lng};
        }
        Random rng = new Random();
        double angle = rng.nextDouble() * 2 * Math.PI;
        double distance = radiusM * Math.sqrt(rng.nextDouble());
        double latOffset = (distance * Math.cos(angle)) / 111320.0;
        double lngOffset = (distance * Math.sin(angle)) / (111320.0 * Math.cos(Math.toRadians(lat)));
        return new double[]{lat + latOffset, lng + lngOffset};
    }
}
