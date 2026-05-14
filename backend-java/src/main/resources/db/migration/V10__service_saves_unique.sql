CREATE UNIQUE INDEX IF NOT EXISTS service_saves_service_id_user_id_key
    ON service_saves (service_id, user_id);
