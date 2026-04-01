-- Migration 003 — Suppression des colonnes dépréciées
-- Date: 2026-04-01
-- Contexte: Ces colonnes ont été remplacées par brand/model/weight (002) ou supprimées
--           de l'interface et de toutes les routes backend.
--
-- Colonnes supprimées :
--   brand_model           → remplacé par les colonnes séparées `brand` et `model`
--   max_duration_days     → supprimé (durée géré via pricing_modes + sessions)
--   rental_duration_unit  → supprimé (non utilisé dans l'API)
--   rental_duration_qty   → supprimé (non utilisé dans l'API)

ALTER TABLE marketplace_products DROP COLUMN IF EXISTS brand_model;
ALTER TABLE marketplace_products DROP COLUMN IF EXISTS max_duration_days;
ALTER TABLE marketplace_products DROP COLUMN IF EXISTS rental_duration_unit;
ALTER TABLE marketplace_products DROP COLUMN IF EXISTS rental_duration_qty;
