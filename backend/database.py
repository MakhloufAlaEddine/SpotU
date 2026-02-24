from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging

logger = logging.getLogger(__name__)

client: AsyncIOMotorClient = None
db = None


async def connect_to_db():
    global client, db
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    await _create_indexes()
    logger.info("Connected to MongoDB")


async def _create_indexes():
    await db.tag_points.create_index([("location", "2dsphere")])
    await db.services.create_index([("location", "2dsphere")])
    await db.users.create_index([("email", 1)], unique=True, sparse=True)
    await db.users.create_index([("user_id", 1)], unique=True)
    await db.user_sessions.create_index([("session_token", 1)])
    await db.user_sessions.create_index([("expires_at", 1)], expireAfterSeconds=0)
    logger.info("Indexes created")


async def close_db():
    if client:
        client.close()


def get_db():
    return db
