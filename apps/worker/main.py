import os
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
mongo_client = MongoClient(os.environ.get("MONGO_URI", "mongodb://localhost:3032/?replicaSet=rs0"))
db = mongo_client.sentinelgraph

# Initialize Neo4j driver
neo4j_driver = GraphDatabase.driver(os.environ.get("NEO4J_URI", "bolt://localhost:3033"), auth=("neo4j", "password"))

SEVERITY_FROM_SCORE = [(90, "critical"), (70, "high"), (40, "medium"), (0, "low")]


def project_incident(payload: Dict[str, Any]):
    """Handles INCIDENT_INGESTED and INCIDENT_UPDATED: upserts the Incident node
    and reconciles its OBSERVED_IN (IP/domain) and INDICATES (malware) edges to
    match the incident's current indicator set."""
    event_id = payload.get("eventId")
    risk = payload.get("risk") or {}
    severity = risk.get("severity") or next(s for t, s in SEVERITY_FROM_SCORE if (risk.get("score") or 0) >= t)
    observed_at = payload.get("observedAt")
    observed_at = observed_at.isoformat() if hasattr(observed_at, "isoformat") else str(observed_at or "")
    indicators = payload.get("extractedIndicators", [])
    ips = [i["value"] for i in indicators if str(i.get("type", "")).lower() == "ip"]
    domains = [i["value"].lower() for i in indicators if str(i.get("type", "")).lower() == "domain"]
    malware = [i["value"] for i in indicators if str(i.get("type", "")).lower() == "malware"]
    now = datetime.utcnow().replace(microsecond=0).isoformat()

    with neo4j_driver.session() as session:
        session.run(
            """
            MERGE (inc:Entity:Incident {entityKey: $eventId})
              ON CREATE SET inc.createdAt = $now, inc.status = 'open'
            SET inc.name = $eventId, inc.eventId = $eventId, inc.eventType = $eventType,
                inc.observedAt = $observedAt, inc.severity = $severity, inc.riskScore = $score,
                inc.region = $region, inc.title = coalesce($title, inc.title, $eventType)
            WITH inc
            OPTIONAL MATCH (inc)-[stale:OBSERVED_IN|INDICATES]->(x)
            WHERE NOT coalesce(x.normalizedValue, '') IN ($ips + $domains)
              AND NOT toLower(coalesce(x.name, '')) IN [m IN $malware | toLower(m)]
            DELETE stale
            """,
            eventId=event_id, eventType=payload.get("eventType"), observedAt=observed_at, severity=severity,
            score=risk.get("score"), region=payload.get("region"), now=now,
            title=(payload.get("rawPayload") or {}).get("title"), ips=ips, domains=domains, malware=malware,
        )
        # Indicators are matched on their normalized value; unseen ones are created.
        for label, prefix, values in (("IPAddress", "IP-", ips), ("Domain", "D-", domains)):
            session.run(
                f"""
                MATCH (inc:Incident {{entityKey: $eventId}})
                UNWIND $values AS v
                MERGE (x:Entity:Indicator:{label} {{normalizedValue: v}})
                  ON CREATE SET x.entityKey = $prefix + v, x.name = v, x.createdAt = $now
                MERGE (inc)-[r:OBSERVED_IN]->(x)
                  ON CREATE SET r.confidence = 0.8, r.source = 'ingest-pipeline', r.firstSeen = $now
                """,
                eventId=event_id, values=values, prefix=prefix, now=now,
            )
        session.run(
            """
            MATCH (inc:Incident {entityKey: $eventId})
            UNWIND $malware AS name
            MATCH (m:Malware) WHERE toLower(m.name) = toLower(name)
            MERGE (inc)-[r:INDICATES]->(m)
              ON CREATE SET r.confidence = 0.75, r.source = 'ingest-pipeline', r.firstSeen = $now
            """,
            eventId=event_id, malware=malware, now=now,
        )

    logger.info(f"Successfully projected incident {event_id} to Neo4j.")


def remove_incident(payload: Dict[str, Any]):
    """Handles INCIDENT_DELETED: removes the incident node and its relationships."""
    event_id = payload.get("eventId")
    with neo4j_driver.session() as session:
        session.run("MATCH (inc:Incident {entityKey: $eventId}) DETACH DELETE inc", eventId=event_id)
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
