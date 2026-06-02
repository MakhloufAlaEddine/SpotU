CREATE TABLE IF NOT EXISTS user_saved_addresses (
    address_id   VARCHAR(255) PRIMARY KEY,
    user_id      VARCHAR(255) NOT NULL,
    label        VARCHAR(255) NOT NULL,
    address      VARCHAR(1000) NOT NULL,
    lat          DOUBLE PRECISION NOT NULL,
    lng          DOUBLE PRECISION NOT NULL,
    icon         VARCHAR(128) NOT NULL DEFAULT 'location-outline',
    position     INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_saved_addresses_user
    ON user_saved_addresses(user_id, position, created_at);
