-- Migration 007 : Index btree sur service_locations(service_id)
--
-- Contexte (audit performance 2026-04-01) :
--   GET /services filtre via EXISTS(SELECT 1 FROM service_locations WHERE service_id=...)
--   Sans cet index, PostgreSQL fait un Seq Scan sur toute la table service_locations.
--   Acceptable avec peu de données, mais coûteux à l'échelle (O(n) → O(log n)).
--
-- Gain attendu :
--   - Accélère le filtre géographique EXISTS de ~5-10× à l'échelle
--   - Accélère aussi _batch_enrich_services_for_search (SELECT ... WHERE service_id = ANY(...))
--   - Aucune régression possible (index pur lecture)

CREATE INDEX IF NOT EXISTS idx_service_locations_service_id
    ON service_locations(service_id);
