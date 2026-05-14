CREATE TABLE IF NOT EXISTS conversations (
    conversation_id  VARCHAR(255) PRIMARY KEY,
    type             VARCHAR(64) NOT NULL DEFAULT 'service',
    context_id       VARCHAR(255),
    context_title    VARCHAR(500),
    created_by       VARCHAR(255),
    last_message_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at       TIMESTAMP WITH TIME ZONE,
    context_deleted  BOOLEAN DEFAULT FALSE
);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS type VARCHAR(64) DEFAULT 'service';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS context_title VARCHAR(500);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS context_deleted BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id  VARCHAR(255) NOT NULL,
    user_id          VARCHAR(255) NOT NULL,
    joined_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_read_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status           VARCHAR(32) NOT NULL DEFAULT 'active',
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    message_id       VARCHAR(255) PRIMARY KEY,
    conversation_id  VARCHAR(255),
    sender_id        VARCHAR(255),
    content          TEXT NOT NULL,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at       TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_conv_participants_status ON conversation_participants(conversation_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_deleted ON messages(deleted_at) WHERE deleted_at IS NOT NULL;
