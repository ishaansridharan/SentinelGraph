import os
import sys

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from neo4j import GraphDatabase
from pymongo import MongoClient

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import cti_store  # noqa: E402
import graph_api  # noqa: E402

app = FastAPI(title="SentinelGraph CTI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3030", "http://127.0.0.1:3030"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

mongo_client = MongoClient(os.environ.get("MONGO_URI", "mongodb://localhost:3032/?replicaSet=rs0"))
db = mongo_client[cti_store.DB_NAME]

neo4j_driver = GraphDatabase.driver(os.environ.get("NEO4J_URI", "bolt://localhost:3033"), auth=("neo4j", "password"))

graph_api.init(neo4j_driver, db)
app.include_router(graph_api.router)


@app.get("/health")
def health_check():
    try:
        mongo_client.admin.command("ping")
        neo4j_driver.verify_connectivity()
        return {"status": "healthy", "mongo": cti_store.DB_NAME, "neo4j": "connected"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
