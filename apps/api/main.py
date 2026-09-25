from datetime import datetime
from typing import List, Dict, Any
import uuid
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient
from pymongo.errors import PyMongoError
from neo4j import GraphDatabase
from pydantic import BaseModel

import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from packages.domain.schemas import (
    IncidentLogSchema, IncidentUpdateSchema, OutboxEventSchema, OutboxStatus,
    PageRankRequest, LeidenRequest, AnalyticsRunResponse
)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

mongo_client = MongoClient("mongodb://localhost:27017/?replicaSet=rs0")
db = mongo_client.sentinelgraph

neo4j_driver = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "password"))

@app.get("/health")
def health_check():
    try:
        mongo_client.admin.command('ping')
        return {"status": "healthy", "database": "connected", "replicaSet": "rs0"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/metrics")
def get_metrics():
    try:
        total_incidents = db.incident_logs.count_documents({})
        pending_outbox  = db.outbox_events.count_documents({"status": "PENDING"})
        severity_counts = list(db.incident_logs.aggregate([
            {"$group": {"_id": "$risk.severity", "count": {"$sum": 1}}}
        ]))
        event_type_counts = list(db.incident_logs.aggregate([
            {"$group": {"_id": "$eventType", "count": {"$sum": 1}}}
        ]))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    try:
        with neo4j_driver.session() as session:
            result = session.run("MATCH (n) RETURN count(n) AS nodeCount")
            node_count = result.single()["nodeCount"]
            result2 = session.run("MATCH ()-[r]->() RETURN count(r) AS relCount")
            rel_count = result2.single()["relCount"]
    except Exception:
        node_count = -1
        rel_count  = -1

    return {
        "totalIncidents":   total_incidents,
        "pendingOutbox":    pending_outbox,
        "graphNodes":       node_count,
        "graphRelationships": rel_count,
        "bySeverity":       {r["_id"]: r["count"] for r in severity_counts},
        "byEventType":      {r["_id"]: r["count"] for r in event_type_counts},
    }

@app.post("/api/v1/incidents", status_code=201)
def create_incident(incident: IncidentLogSchema):
    incident_dict = incident.model_dump(by_alias=True)
    
    outbox_doc = {
        "eventId": f"out_{incident.event_id}",
        "aggregateId": incident.event_id,
        "eventType": "INCIDENT_INGESTED",
        "payload": incident_dict,
        "status": "pending",
        "attempts": 0,
        "createdAt": datetime.utcnow()
    }

    try:
        with mongo_client.start_session() as session:
            with session.start_transaction():
                db.incident_logs.insert_one(incident_dict, session=session)
                db.outbox_events.insert_one(outbox_doc, session=session)
                
        return {
            "status": "success", 
            "message": "Incident ingested and queued for graph projection", 
            "eventId": incident.event_id
        }
    except PyMongoError as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/incidents")
def list_incidents(limit: int = Query(default=100, ge=1, le=500), skip: int = Query(default=0, ge=0)):
    try:
        incidents = list(
            db.incident_logs.find({}, {"_id": 0})
            .sort("observedAt", -1)
            .skip(skip)
            .limit(limit)
        )
        total = db.incident_logs.count_documents({})
    except PyMongoError as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"total": total, "incidents": incidents}

@app.get("/api/v1/incidents/{event_id}")
def get_incident(event_id: str):
    try:
        incident = db.incident_logs.find_one({"eventId": event_id}, {"_id": 0})
    except PyMongoError as e:
        raise HTTPException(status_code=500, detail=str(e))

    if incident is None:
        raise HTTPException(status_code=404, detail=f"Incident {event_id} not found")

    return incident

@app.put("/api/v1/incidents/{event_id}")
def replace_incident(event_id: str, incident: IncidentLogSchema):
    if incident.event_id != event_id:
        raise HTTPException(
            status_code=400,
            detail="eventId in request body must match eventId in URL path"
        )

    existing = db.incident_logs.find_one({"eventId": event_id})
    if existing is None:
        raise HTTPException(status_code=404, detail=f"Incident {event_id} not found")

    incident_dict = incident.model_dump(by_alias=True)

    outbox_doc = {
        "eventId": f"out_{uuid.uuid4()}",
        "aggregateId": event_id,
        "eventType": "INCIDENT_UPDATED",
        "payload": incident_dict,
        "status": "pending",
        "attempts": 0,
        "createdAt": datetime.utcnow()
    }

    try:
        with mongo_client.start_session() as session:
            with session.start_transaction():
                db.incident_logs.replace_one({"eventId": event_id}, incident_dict, session=session)
                db.outbox_events.insert_one(outbox_doc, session=session)

        return {
            "status": "success",
            "message": "Incident replaced and queued for graph projection",
            "eventId": event_id
        }
    except PyMongoError as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/api/v1/incidents/{event_id}")
def update_incident(event_id: str, patch: IncidentUpdateSchema):
    update_fields = patch.model_dump(by_alias=True, exclude_unset=True)
    if not update_fields:
        raise HTTPException(status_code=400, detail="No fields provided to update")

    existing = db.incident_logs.find_one({"eventId": event_id})
    if existing is None:
        raise HTTPException(status_code=404, detail=f"Incident {event_id} not found")

    merged = {**existing, **update_fields}
    merged.pop("_id", None)

    outbox_doc = {
        "eventId": f"out_{uuid.uuid4()}",
        "aggregateId": event_id,
        "eventType": "INCIDENT_UPDATED",
        "payload": merged,
        "status": "pending",
        "attempts": 0,
        "createdAt": datetime.utcnow()
    }

    try:
        with mongo_client.start_session() as session:
            with session.start_transaction():
                db.incident_logs.update_one(
                    {"eventId": event_id}, {"$set": update_fields}, session=session
                )
                db.outbox_events.insert_one(outbox_doc, session=session)

        return {
            "status": "success",
            "message": "Incident updated and queued for graph projection",
            "eventId": event_id
        }
    except PyMongoError as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/v1/incidents/{event_id}")
def delete_incident(event_id: str):
    existing = db.incident_logs.find_one({"eventId": event_id})
    if existing is None:
        raise HTTPException(status_code=404, detail=f"Incident {event_id} not found")

    outbox_doc = {
        "eventId": f"out_{uuid.uuid4()}",
        "aggregateId": event_id,
        "eventType": "INCIDENT_DELETED",
        "payload": {"eventId": event_id},
        "status": "pending",
        "attempts": 0,
        "createdAt": datetime.utcnow()
    }

    try:
        with mongo_client.start_session() as session:
            with session.start_transaction():
                db.incident_logs.delete_one({"eventId": event_id}, session=session)
                db.outbox_events.insert_one(outbox_doc, session=session)

        return {
            "status": "success",
            "message": "Incident deleted and queued for graph removal",
            "eventId": event_id
        }
    except PyMongoError as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/graph/blast-radius/{entityKey}")
def get_blast_radius(entityKey: str):
    query = """
    MATCH (origin)
    WHERE (origin.entityKey IS NOT NULL AND toLower(origin.entityKey) = toLower($key))
       OR (origin.id IS NOT NULL AND toLower(origin.id) = toLower($key))
       OR (origin.name IS NOT NULL AND toLower(origin.name) = toLower($key))
       OR (origin.label IS NOT NULL AND toLower(origin.label) = toLower($key))
       OR (origin.value IS NOT NULL AND toLower(origin.value) = toLower($key))
       OR (origin.entityKey IS NOT NULL AND toLower(origin.entityKey) CONTAINS toLower($key))
       OR (origin.id IS NOT NULL AND toLower(origin.id) CONTAINS toLower($key))
       OR (origin.name IS NOT NULL AND toLower(origin.name) CONTAINS toLower($key))
    OPTIONAL MATCH (origin)-[r]-(connected)
    RETURN origin, labels(origin) AS origin_labels, r, type(r) AS rel_type, connected, labels(connected) AS connected_labels
    LIMIT 200
    """
    
    with neo4j_driver.session() as session:
        result = session.run(query, key=entityKey)
        
        nodes_seen = set()
        edges_seen = set()
        nodes = []
        edges = []
        origin_dict = {}

        for record in result:
            o = record["origin"]
            if o and o.element_id not in nodes_seen:
                nodes_seen.add(o.element_id)
                d = dict(o)
                d["_labels"] = list(o.labels)
                d["_element_id"] = o.element_id
                nodes.append(d)
                if not origin_dict:
                    origin_dict = d

            c = record["connected"]
            if c and c.element_id not in nodes_seen:
                nodes_seen.add(c.element_id)
                d = dict(c)
                d["_labels"] = list(c.labels)
                d["_element_id"] = c.element_id
                nodes.append(d)

            r = record["r"]
            if r and r.element_id not in edges_seen:
                edges_seen.add(r.element_id)
                rd = dict(r)
                rd["_element_id"] = r.element_id
                rd["_start_id"] = r.start_node.element_id
                rd["_end_id"] = r.end_node.element_id
                rd["_type"] = record["rel_type"]
                edges.append(rd)

        return {
            "origin": origin_dict,
            "nodes": nodes,
            "edges": edges
        }

@app.get("/api/v1/graph/full")
def get_full_graph():
    nodes_query = "MATCH (n) RETURN n, labels(n) AS lbls"
    edges_query = "MATCH (a)-[r]->(b) RETURN a, r, b, type(r) AS rel_type"

    with neo4j_driver.session() as session:
        nodes_result = session.run(nodes_query)
        nodes = []
        for record in nodes_result:
            node = record["n"]
            props = dict(node)
            props["_labels"] = record["lbls"]
            props["_element_id"] = node.element_id
            nodes.append(props)

        edges_result = session.run(edges_query)
        edges = []
        for record in edges_result:
            rel = record["r"]
            props = dict(rel)
            props["_element_id"] = rel.element_id
            props["_start_id"]   = record["a"].element_id
            props["_end_id"]     = record["b"].element_id
            props["_type"]       = record["rel_type"]
            edges.append(props)

    return {"nodes": nodes, "edges": edges}

@app.post("/api/v1/analytics/pagerank/run", response_model=AnalyticsRunResponse)
def run_pagerank(request: PageRankRequest):
    run_id = str(uuid.uuid4())
    
    with neo4j_driver.session() as session:
        session.run("CALL gds.graph.drop('cti-infrastructure', false)")
        
        session.run(
            "CALL gds.graph.project('cti-infrastructure', ['Malware', 'Domain', 'IPAddress', 'ThreatActor', 'Incident'], "
            "{COMMUNICATES_WITH: {orientation: 'NATURAL', properties: 'confidence'}, "
            "RESOLVES_TO: {orientation: 'NATURAL', properties: 'confidence'}, "
            "INDICATES: {orientation: 'NATURAL', properties: 'confidence'}})"
        )
        
        result = session.run(
            "CALL gds.pageRank.write('cti-infrastructure', {maxIterations: $maxIterations, "
            "dampingFactor: $dampingFactor, relationshipWeightProperty: $weightProperty, "
            "writeProperty: 'pageRankScore'}) YIELD nodePropertiesWritten, ranIterations",
            maxIterations=request.max_iterations,
            dampingFactor=request.damping_factor,
            weightProperty=request.weight_property
        )
        record = result.single()
        metrics = {
            "nodePropertiesWritten": record["nodePropertiesWritten"] if record else 0,
            "ranIterations": record["ranIterations"] if record else 0
        }
        
        session.run("CALL gds.graph.drop('cti-infrastructure', false)")
        
    return AnalyticsRunResponse(
        run_id=run_id,
        algorithm="Weighted PageRank",
        status="completed",
        metrics=metrics
    )

@app.post("/api/v1/analytics/communities/run", response_model=AnalyticsRunResponse)
def run_communities(request: LeidenRequest):
    run_id = str(uuid.uuid4())
    
    with neo4j_driver.session() as session:
        session.run("CALL gds.graph.drop('cti-infrastructure', false)")
        
        session.run(
            "CALL gds.graph.project('cti-communities', ['Malware', 'Domain', 'IPAddress', 'ThreatActor', 'Incident'], "
            "{COMMUNICATES_WITH: {orientation: 'UNDIRECTED', properties: 'confidence'}, "
            "RESOLVES_TO: {orientation: 'UNDIRECTED', properties: 'confidence'}, "
            "INDICATES: {orientation: 'UNDIRECTED', properties: 'confidence'}})"
        )
        
        result = session.run(
            "CALL gds.leiden.write('cti-communities', {relationshipWeightProperty: $weightProperty, "
            "writeProperty: 'campaignClusterId', includeIntermediateCommunities: $includeIntermediate}) "
            "YIELD communityCount, modularities",
            weightProperty=request.weight_property,
            includeIntermediate=request.include_intermediate
        )
        record = result.single()
        metrics = {
            "communityCount": record["communityCount"] if record else 0,
            "modularities": record["modularities"] if record else []
        }
        
        session.run("CALL gds.graph.drop('cti-communities', false)")
        
    return AnalyticsRunResponse(
        run_id=run_id,
        algorithm="Leiden Community Detection",
        status="completed",
        metrics=metrics
    )
