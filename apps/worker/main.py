import time
import logging
from typing import Dict, Any
from datetime import datetime
from pymongo import MongoClient
from neo4j import GraphDatabase

# Configure structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger(__name__)

# Initialize MongoDB client
mongo_client = MongoClient("mongodb://localhost:27017/?replicaSet=rs0")
db = mongo_client.sentinelgraph

# Initialize Neo4j driver
neo4j_driver = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "password"))

def format_indicator(ind: dict) -> dict:
    raw_type = ind.get("type", "")
    type_label_map = {
        "domain": "Domain",
        "ip": "IPAddress",
        "hash": "Hash",
        "url": "URL",
        "email": "EmailAddress"
    }
    type_label = type_label_map.get(raw_type.lower(), raw_type.capitalize())
    
    return {
        "key": f"{raw_type}--{ind.get('value')}",
        "value": ind.get("value"),
        "type": raw_type,
        "typeLabel": type_label,
        "confidence": ind.get("confidence", 80)
    }

def project_incident(payload: Dict[str, Any]):
    """Handles INCIDENT_INGESTED and INCIDENT_UPDATED: upserts the incident node
    and reconciles its INDICATES edges to match the current indicator set."""
    event_id = payload.get("eventId")
    event_type = payload.get("eventType")
    observed_at = payload.get("observedAt")
    extracted_indicators = payload.get("extractedIndicators", [])

    incident_key = f"incident--{event_id}"

    # Format the indicator list
    indicators = [format_indicator(ind) for ind in extracted_indicators]
    indicator_keys = [ind["key"] for ind in indicators]

    cypher_query = """
    MERGE (inc:Incident:Entity {entityKey: $incidentKey})
      SET inc.observedAt = $observedAt, inc.eventType = $eventType
    WITH inc
    OPTIONAL MATCH (inc)-[stale:INDICATES]->(staleInd)
    WHERE NOT staleInd.entityKey IN $indicatorKeys
    DELETE stale
    WITH inc
    UNWIND $indicators AS ind
    MERGE (node:Indicator:Entity {entityKey: ind.key})
      ON CREATE SET node.value = ind.value, node.type = ind.type
    WITH inc, node, ind
    CALL apoc.create.addLabels(node, [ind.typeLabel]) YIELD node AS labeledNode
    MERGE (inc)-[r:INDICATES]->(labeledNode)
      ON CREATE SET r.confidence = ind.confidence, r.relationshipKey = $incidentKey + "--" + ind.key
    """

    with neo4j_driver.session() as session:
        session.run(
            cypher_query,
            incidentKey=incident_key,
            observedAt=observed_at,
            eventType=event_type,
            indicators=indicators,
            indicatorKeys=indicator_keys
        )

    logger.info(f"Successfully projected incident {event_id} to Neo4j.")


def remove_incident(payload: Dict[str, Any]):
    """Handles INCIDENT_DELETED: removes the incident node and its relationships."""
    event_id = payload.get("eventId")
    incident_key = f"incident--{event_id}"

    cypher_query = """
    MATCH (inc:Incident:Entity {entityKey: $incidentKey})
    DETACH DELETE inc
    """

    with neo4j_driver.session() as session:
        session.run(cypher_query, incidentKey=incident_key)

    logger.info(f"Successfully removed incident {event_id} from Neo4j.")


def process_outbox():
    logger.info("Starting outbox worker loop...")
    while True:
        try:
            # Atomic Event Claim
            event = db.outbox_events.find_one_and_update(
                {"status": "pending"},
                {"$set": {"status": "processing"}},
                sort=[("createdAt", 1)]
            )

            if event is None:
                time.sleep(1)
                continue

            payload = event.get("payload", {})
            outbox_event_type = event.get("eventType")

            if outbox_event_type in ("INCIDENT_INGESTED", "INCIDENT_UPDATED"):
                project_incident(payload)
            elif outbox_event_type == "INCIDENT_DELETED":
                remove_incident(payload)
            else:
                logger.warning(f"Unknown outbox event type '{outbox_event_type}', skipping.")

            # Success Outcome
            db.outbox_events.update_one(
                {"_id": event["_id"]},
                {"$set": {"status": "processed", "processedAt": datetime.utcnow()}}
            )

        except Exception as e:
            if 'event' in locals() and event is not None:
                logger.error(f"Error processing event {event.get('_id')}: {e}", exc_info=True)
                db.outbox_events.update_one(
                    {"_id": event["_id"]},
                    {
                        "$set": {"status": "pending", "lastError": str(e)},
                        "$inc": {"attempts": 1}
                    }
                )
            else:
                logger.error(f"Error in worker loop: {e}", exc_info=True)
            
            time.sleep(1)

if __name__ == "__main__":
    process_outbox()
