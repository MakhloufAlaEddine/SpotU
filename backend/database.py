from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# MongoDB client and database
client: Optional[AsyncIOMotorClient] = None
db = None


def serialize_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Convert MongoDB document to JSON-serializable dict."""
    if doc is None:
        return None
    result = {}
    for key, val in doc.items():
        if key == '_id':
            result['id'] = str(val)
        elif isinstance(val, ObjectId):
            result[key] = str(val)
        elif isinstance(val, datetime):
            result[key] = val.isoformat()
        elif isinstance(val, list):
            result[key] = [serialize_doc(item) if isinstance(item, dict) else item for item in val]
        elif isinstance(val, dict):
            result[key] = serialize_doc(val)
        else:
            result[key] = val
    return result


def serialize_docs(docs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Convert list of MongoDB documents to JSON-serializable list."""
    return [serialize_doc(doc) for doc in docs]


async def connect_to_db():
    global client, db
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "winek_db")
    
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    
    # Create indexes
    await db.users.create_index("email", unique=True, sparse=True)
    await db.users.create_index("user_id", unique=True)
    await db.tag_points.create_index([("location", "2dsphere")])
    await db.tag_points.create_index("user_id")
    await db.services.create_index([("location", "2dsphere")])
    await db.services.create_index("coach_id")
    await db.bookings.create_index("user_id")
    await db.bookings.create_index("service_id")
    
    logger.info(f"Connected to MongoDB: {db_name}")


async def close_db():
    global client
    if client:
        client.close()
        logger.info("MongoDB connection closed")


def get_db():
    return db


# Helper functions for common operations
async def find_user_by_id(user_id: str) -> Optional[Dict]:
    doc = await db.users.find_one({"user_id": user_id})
    return serialize_doc(doc) if doc else None


async def find_user_by_email(email: str) -> Optional[Dict]:
    doc = await db.users.find_one({"email": email})
    return serialize_doc(doc) if doc else None


async def create_user(user_data: Dict) -> Dict:
    user_data["created_at"] = datetime.now(timezone.utc)
    user_data["updated_at"] = datetime.now(timezone.utc)
    result = await db.users.insert_one(user_data)
    user_data["_id"] = result.inserted_id
    return serialize_doc(user_data)


async def update_user(user_id: str, update_data: Dict) -> Optional[Dict]:
    update_data["updated_at"] = datetime.now(timezone.utc)
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": update_data}
    )
    return await find_user_by_id(user_id)


# Tag Points operations
async def create_tag_point(point_data: Dict) -> Dict:
    point_data["created_at"] = datetime.now(timezone.utc)
    point_data["updated_at"] = datetime.now(timezone.utc)
    point_data["active"] = True
    result = await db.tag_points.insert_one(point_data)
    point_data["_id"] = result.inserted_id
    return serialize_doc(point_data)


async def find_tag_points_near(lat: float, lng: float, radius_meters: float, domain_id: str = None) -> List[Dict]:
    query = {
        "active": True,
        "location": {
            "$nearSphere": {
                "$geometry": {
                    "type": "Point",
                    "coordinates": [lng, lat]
                },
                "$maxDistance": radius_meters
            }
        }
    }
    if domain_id:
        query["domain_id"] = domain_id
    
    cursor = db.tag_points.find(query).limit(100)
    docs = await cursor.to_list(length=100)
    
    # Calculate distance for each point
    result = []
    for doc in docs:
        serialized = serialize_doc(doc)
        if doc.get("location") and doc["location"].get("coordinates"):
            coords = doc["location"]["coordinates"]
            # Simple distance calculation (approximate)
            from math import radians, cos, sin, sqrt, atan2
            R = 6371000  # Earth's radius in meters
            lat1, lon1 = radians(lat), radians(lng)
            lat2, lon2 = radians(coords[1]), radians(coords[0])
            dlat = lat2 - lat1
            dlon = lon2 - lon1
            a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
            c = 2 * atan2(sqrt(a), sqrt(1-a))
            serialized["distance"] = R * c
        result.append(serialized)
    
    return result


async def find_tag_points_by_user(user_id: str) -> List[Dict]:
    cursor = db.tag_points.find({"user_id": user_id, "active": True})
    docs = await cursor.to_list(length=100)
    return serialize_docs(docs)


async def find_tag_point_by_id(point_id: str) -> Optional[Dict]:
    doc = await db.tag_points.find_one({"point_id": point_id})
    return serialize_doc(doc) if doc else None


# Services operations
async def create_service(service_data: Dict) -> Dict:
    service_data["created_at"] = datetime.now(timezone.utc)
    service_data["updated_at"] = datetime.now(timezone.utc)
    service_data["active"] = True
    result = await db.services.insert_one(service_data)
    service_data["_id"] = result.inserted_id
    return serialize_doc(service_data)


async def find_services_near(lat: float, lng: float, radius_meters: float, domain_id: str = None) -> List[Dict]:
    query = {"active": True}
    
    if lat and lng:
        query["location"] = {
            "$nearSphere": {
                "$geometry": {
                    "type": "Point",
                    "coordinates": [lng, lat]
                },
                "$maxDistance": radius_meters
            }
        }
    
    if domain_id:
        query["domain_id"] = domain_id
    
    cursor = db.services.find(query).limit(50)
    docs = await cursor.to_list(length=50)
    return serialize_docs(docs)


async def find_services_by_coach(coach_id: str) -> List[Dict]:
    cursor = db.services.find({"coach_id": coach_id, "active": True})
    docs = await cursor.to_list(length=50)
    return serialize_docs(docs)


async def find_service_by_id(service_id: str) -> Optional[Dict]:
    doc = await db.services.find_one({"service_id": service_id})
    return serialize_doc(doc) if doc else None


# Bookings operations
async def create_booking(booking_data: Dict) -> Dict:
    booking_data["created_at"] = datetime.now(timezone.utc)
    booking_data["updated_at"] = datetime.now(timezone.utc)
    result = await db.bookings.insert_one(booking_data)
    booking_data["_id"] = result.inserted_id
    return serialize_doc(booking_data)


async def find_bookings_by_user(user_id: str) -> List[Dict]:
    cursor = db.bookings.find({"user_id": user_id})
    docs = await cursor.to_list(length=100)
    return serialize_docs(docs)


async def find_booking_by_id(booking_id: str) -> Optional[Dict]:
    doc = await db.bookings.find_one({"booking_id": booking_id})
    return serialize_doc(doc) if doc else None


async def update_booking(booking_id: str, update_data: Dict) -> Optional[Dict]:
    update_data["updated_at"] = datetime.now(timezone.utc)
    await db.bookings.update_one(
        {"booking_id": booking_id},
        {"$set": update_data}
    )
    return await find_booking_by_id(booking_id)


# Domains and Tags
async def get_all_domains() -> List[Dict]:
    cursor = db.domains.find({"active": True})
    docs = await cursor.to_list(length=50)
    return serialize_docs(docs)


async def get_tags_by_domain(domain_id: str) -> List[Dict]:
    cursor = db.tags.find({"domain_id": domain_id, "active": True})
    docs = await cursor.to_list(length=100)
    return serialize_docs(docs)


async def get_tag_categories_by_domain(domain_id: str) -> List[Dict]:
    cursor = db.tag_categories.find({"domain_id": domain_id, "active": True})
    docs = await cursor.to_list(length=50)
    return serialize_docs(docs)
