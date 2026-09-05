// Connect to the sentinelgraph database
db = db.getSiblingDB('sentinelgraph');

// Create incident_logs collection with strict JSON Schema Validation
db.createCollection("incident_logs", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["eventId", "eventType", "observedAt", "rawPayload", "version"],
      properties: {
        eventId: {
          bsonType: "string",
          description: "Must be a string and is required"
        },
        eventType: {
          enum: ["phishing_email", "malware_execution", "network_scan"]
        },
        observedAt: {
          bsonType: "date"
        },
        risk: {
          bsonType: "object",
          required: ["score", "severity"],
          properties: {
            score: {
              bsonType: "int",
              minimum: 0,
              maximum: 100
            },
            severity: {
              enum: ["low", "medium", "high", "critical"]
            }
          }
        }
      }
    }
  }
});

// Create outbox_events collection
db.createCollection("outbox_events");

// Create MongoDB Indexes
db.incident_logs.createIndex({ eventId: 1 }, { unique: true });
db.incident_logs.createIndex({ "risk.score": -1, observedAt: -1 });
db.outbox_events.createIndex({ status: 1, createdAt: 1 });
