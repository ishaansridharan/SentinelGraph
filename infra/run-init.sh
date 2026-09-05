#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Apply MongoDB initialization script
mongosh mongodb://localhost:27017/sentinelgraph?replicaSet=rs0 -f "$DIR/mongo-init.js"

# Apply Neo4j initialization script
cypher-shell -a neo4j://localhost:7687 -u neo4j -p password -f "$DIR/neo4j-init.cypher"
