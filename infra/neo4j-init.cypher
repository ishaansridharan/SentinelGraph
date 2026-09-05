// Constraints
CREATE CONSTRAINT entity_key_unique IF NOT EXISTS FOR (e:Entity) REQUIRE e.entityKey IS UNIQUE;
CREATE CONSTRAINT rel_key_unique IF NOT EXISTS FOR ()-[r:INDICATES]-() REQUIRE r.relationshipKey IS UNIQUE;

// Indexes
CREATE INDEX indicator_value_idx IF NOT EXISTS FOR (i:Indicator) ON (i.value);
CREATE INDEX incident_date_idx IF NOT EXISTS FOR (i:Incident) ON (i.observedAt);
