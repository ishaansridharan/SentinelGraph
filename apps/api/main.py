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
    IncidentLogSchema, OutboxEventSchema, OutboxStatus,
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

@app.get("/api/v1/graph/blast-radius/{entityKey}")
def get_blast_radius(entityKey: str, max_hops: int = Query(3), min_confidence: int = Query(50)):
    query = """
    MATCH p=(origin:Entity {entityKey: $entityKey})-[r*1..3]-(connected:Entity)
    WHERE ALL(rel IN r WHERE rel.confidence >= $min_confidence)
    RETURN origin, nodes(p) AS nodes, relationships(p) AS edges
    """
    
    with neo4j_driver.session() as session:
        result = session.run(query, entityKey=entityKey, min_confidence=min_confidence)
        
        response_data = {
            "origin": {},
            "nodes": [],
            "edges": []
        }
        
        nodes_seen = set()
        edges_seen = set()

        for record in result:
            origin_node = record["origin"]
            if not response_data["origin"]:
                response_data["origin"] = dict(origin_node)
            
            for node in record["nodes"]:
                node_id = node.element_id
                if node_id not in nodes_seen:
                    nodes_seen.add(node_id)
                    response_data["nodes"].append(dict(node))
            
            for edge in record["edges"]:
                edge_id = edge.element_id
                if edge_id not in edges_seen:
                    edges_seen.add(edge_id)
                    response_data["edges"].append(dict(edge))

        return response_data

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
            "CALL gds.graph.project('cti-infrastructure', ['Malware', 'Domain', 'IPAddress', 'ThreatActor', 'Incident'], "
            "{COMMUNICATES_WITH: {orientation: 'NATURAL', properties: 'confidence'}, "
            "RESOLVES_TO: {orientation: 'NATURAL', properties: 'confidence'}, "
            "INDICATES: {orientation: 'NATURAL', properties: 'confidence'}})"
        )
        
        result = session.run(
            "CALL gds.leiden.write('cti-infrastructure', {relationshipWeightProperty: $weightProperty, "
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
        
        session.run("CALL gds.graph.drop('cti-infrastructure', false)")
        
    return AnalyticsRunResponse(
        run_id=run_id,
        algorithm="Leiden Community Detection",
        status="completed",
        metrics=metrics
    )
