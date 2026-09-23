"""
Full-coverage CTI seed script.

Populates:
  - MongoDB: 50 IncidentLog documents + corresponding OutboxEvent documents
  - Neo4j:   All node types (Malware, Domain, IPAddress, ThreatActor, Incident)
             All relationship types (COMMUNICATES_WITH, RESOLVES_TO, INDICATES,
             ATTRIBUTED_TO, TARGETS, DELIVERS, EXPLOITS)
             With confidence weights on every relationship
"""
import sys, os, uuid, random
from datetime import datetime, timedelta

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__))))

from pymongo import MongoClient
from neo4j import GraphDatabase

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
MONGO_URI = "mongodb://localhost:27017/?replicaSet=rs0"
NEO4J_URI = "bolt://localhost:7687"
NEO4J_AUTH = ("neo4j", "password")

mongo = MongoClient(MONGO_URI)
db = mongo.sentinelgraph
driver = GraphDatabase.driver(NEO4J_URI, auth=NEO4J_AUTH)

# ---------------------------------------------------------------------------
# Reference data pools
# ---------------------------------------------------------------------------
THREAT_ACTORS = [
    {"id": "ta-apt28",     "name": "APT28",       "alias": "Fancy Bear",      "origin": "RU", "ttps": ["T1566", "T1078"]},
    {"id": "ta-apt29",     "name": "APT29",       "alias": "Cozy Bear",       "origin": "RU", "ttps": ["T1195", "T1021"]},
    {"id": "ta-lazarus",   "name": "Lazarus",     "alias": "Hidden Cobra",    "origin": "KP", "ttps": ["T1059", "T1105"]},
    {"id": "ta-fin7",      "name": "FIN7",        "alias": "Carbanak",        "origin": "UA", "ttps": ["T1204", "T1071"]},
    {"id": "ta-cobaltstrike","name": "CobaltGang","alias": "CG-1337",         "origin": "CN", "ttps": ["T1055", "T1003"]},
]

MALWARE = [
    {"id": "mal-emotet",   "name": "Emotet",    "family": "Trojan",    "capability": "loader"},
    {"id": "mal-trickbot", "name": "TrickBot",  "family": "Trojan",    "capability": "credential-theft"},
    {"id": "mal-ryuk",     "name": "Ryuk",      "family": "Ransomware","capability": "encryption"},
    {"id": "mal-cobalt",   "name": "CobaltStrike","family":"RAT",      "capability": "c2"},
    {"id": "mal-mimikatz", "name": "Mimikatz",  "family": "Tool",      "capability": "credential-dump"},
    {"id": "mal-njrat",    "name": "NjRAT",     "family": "RAT",       "capability": "remote-access"},
    {"id": "mal-blackcat", "name": "BlackCat",  "family": "Ransomware","capability": "encryption"},
    {"id": "mal-qakbot",   "name": "QakBot",    "family": "Trojan",    "capability": "lateral-movement"},
]

DOMAINS = [
    {"id": "dom-c2-ru01",  "value": "update-srv01.ru",      "role": "c2"},
    {"id": "dom-c2-cn01",  "value": "cdn-fast-dl.cn",       "role": "c2"},
    {"id": "dom-phish01",  "value": "secure-banking-in.net","role": "phishing"},
    {"id": "dom-phish02",  "value": "microsoft-update.pw",  "role": "phishing"},
    {"id": "dom-exfil01",  "value": "logs.telemetry-hub.io","role": "exfiltration"},
    {"id": "dom-drop01",   "value": "dl.payload-host.biz",  "role": "dropper"},
    {"id": "dom-c2-kp01",  "value": "nk-relay.onion.re",    "role": "c2"},
    {"id": "dom-c2-ua01",  "value": "api.fin7-panel.shop",  "role": "c2"},
    {"id": "dom-exfil02",  "value": "backup.exfil-store.cc","role": "exfiltration"},
    {"id": "dom-phish03",  "value": "paypal-verify-id.info","role": "phishing"},
]

IPS = [
    {"id": "ip-ru01",  "value": "185.220.101.42",  "asn": "AS60068", "country": "RU"},
    {"id": "ip-cn01",  "value": "103.75.190.12",   "asn": "AS45090", "country": "CN"},
    {"id": "ip-nl01",  "value": "45.142.212.100",  "asn": "AS206804","country": "NL"},
    {"id": "ip-us01",  "value": "23.106.122.83",   "asn": "AS20473", "country": "US"},
    {"id": "ip-de01",  "value": "194.165.16.72",   "asn": "AS48693", "country": "DE"},
    {"id": "ip-kp01",  "value": "175.45.176.3",    "asn": "AS131279","country": "KP"},
    {"id": "ip-ua01",  "value": "91.218.114.37",   "asn": "AS43810", "country": "UA"},
    {"id": "ip-ro01",  "value": "5.188.86.250",    "asn": "AS197595","country": "RO"},
]

EVENT_TYPES = [
    "phishing_email",
    "malware_execution",
    "network_scan",
]
REGIONS = ["IN", "US", "EU", "APAC", "ME", "LATAM"]
CLASSIFICATIONS = ["TLP:WHITE", "TLP:GREEN", "TLP:AMBER", "TLP:RED"]
SEVERITIES = ["low", "medium", "high", "critical"]

def rand_conf(lo=50, hi=99):
    return random.randint(lo, hi)

def rand_ts():
    days_back = random.randint(0, 180)
    return datetime.utcnow() - timedelta(days=days_back, hours=random.randint(0, 23))

# ---------------------------------------------------------------------------
# Build 50 incidents
# ---------------------------------------------------------------------------
incidents = []
for i in range(50):
    ta   = random.choice(THREAT_ACTORS)
    mal  = random.choice(MALWARE)
    dom  = random.choice(DOMAINS)
    ip   = random.choice(IPS)
    etype = random.choice(EVENT_TYPES)
    sev   = random.choice(SEVERITIES)

    indicators = [
        {"type": "domain", "value": dom["value"], "confidence": rand_conf()},
        {"type": "ip",     "value": ip["value"],  "confidence": rand_conf()},
        {"type": "malware","value": mal["name"],   "confidence": rand_conf(60, 99)},
    ]

    doc = {
        "eventId": f"evt-{uuid.uuid4().hex[:12]}",
        "eventType": etype,
        "observedAt": rand_ts(),
        "classification": random.choice(CLASSIFICATIONS),
        "region": random.choice(REGIONS),
        "version": "1.0",
        "rawPayload": {
            "source": f"sensor-{random.randint(1,20):02d}",
            "threatActor": ta["name"],
            "malwareFamily": mal["family"],
            "targetDomain": dom["value"],
            "sourceIP": ip["value"],
            "ttp": random.choice(ta["ttps"]),
        },
        "extractedIndicators": indicators,
        "risk": {
            "score": int({"low": 25, "medium": 50, "high": 75, "critical": 95}[sev]),
            "severity": sev,
            "reasons": [f"Known {ta['name']} TTP", f"{mal['capability']} capability detected"],
        },
        # store references for graph wiring
        "_ta_id":  ta["id"],
        "_mal_id": mal["id"],
        "_dom_id": dom["id"],
        "_ip_id":  ip["id"],
    }
    incidents.append(doc)

# ---------------------------------------------------------------------------
# Write to MongoDB (inside a transaction)
# ---------------------------------------------------------------------------
db.incident_logs.delete_many({})
db.outbox_events.delete_many({})
print(f"Cleared existing collections.")

incident_docs = []
outbox_docs   = []
for doc in incidents:
    clean = {k: v for k, v in doc.items() if not k.startswith("_")}
    incident_docs.append(clean)
    outbox_docs.append({
        "eventId":     f"out_{doc['eventId']}",
        "aggregateId":  doc["eventId"],
        "eventType":   "INCIDENT_INGESTED",
        "payload":      clean,
        "status":      "PENDING",
        "attempts":     0,
        "createdAt":   datetime.utcnow(),
    })

with mongo.start_session() as sess:
    with sess.start_transaction():
        db.incident_logs.insert_many(incident_docs, session=sess)
        db.outbox_events.insert_many(outbox_docs,   session=sess)

print(f"Inserted {len(incident_docs)} incidents and {len(outbox_docs)} outbox events into MongoDB.")

# ---------------------------------------------------------------------------
# Write to Neo4j
# ---------------------------------------------------------------------------
def seed_graph(tx):
    # Clear everything
    tx.run("MATCH (n) DETACH DELETE n")

    # ThreatActors
    for ta in THREAT_ACTORS:
        tx.run(
            "MERGE (n:ThreatActor {id: $id}) "
            "SET n.name=$name, n.alias=$alias, n.origin=$origin, n.ttps=$ttps, n.entityKey=$id",
            id=ta["id"], name=ta["name"], alias=ta["alias"], origin=ta["origin"],
            ttps=",".join(ta["ttps"])
        )

    # Malware
    for m in MALWARE:
        tx.run(
            "MERGE (n:Malware {id: $id}) "
            "SET n.name=$name, n.family=$family, n.capability=$capability, n.entityKey=$id, n.label=$name",
            **m
        )

    # Domains
    for d in DOMAINS:
        tx.run(
            "MERGE (n:Domain {id: $id}) "
            "SET n.value=$value, n.role=$role, n.entityKey=$value, n.label=$value, n.type='Domain'",
            **d
        )

    # IPs
    for ip in IPS:
        tx.run(
            "MERGE (n:IPAddress {id: $id}) "
            "SET n.value=$value, n.asn=$asn, n.country=$country, n.entityKey=$value, n.label=$value",
            **ip
        )

    # Incidents (one per event doc)
    for doc in incidents:
        tx.run(
            "MERGE (n:Incident {id: $eventId}) "
            "SET n.eventType=$eventType, n.severity=$severity, n.region=$region, "
            "    n.entityKey=$eventId, n.label=$eventId, n.type='Incident'",
            eventId=doc["eventId"],
            eventType=doc["eventType"],
            severity=doc["risk"]["severity"],
            region=doc["region"],
        )

    # Relationships per incident
    for doc in incidents:
        eid    = doc["eventId"]
        ta_id  = doc["_ta_id"]
        mal_id = doc["_mal_id"]
        dom_id = doc["_dom_id"]
        ip_id  = doc["_ip_id"]
        conf_high = rand_conf(70, 99)
        conf_med  = rand_conf(50, 85)
        conf_low  = rand_conf(40, 75)

        # Incident INDICATES Malware
        tx.run(
            "MATCH (i:Incident {id:$eid}), (m:Malware {id:$mid}) "
            "MERGE (i)-[r:INDICATES]->(m) SET r.confidence=$conf",
            eid=eid, mid=mal_id, conf=conf_high
        )
        # Malware COMMUNICATES_WITH Domain
        tx.run(
            "MATCH (m:Malware {id:$mid}), (d:Domain {id:$did}) "
            "MERGE (m)-[r:COMMUNICATES_WITH]->(d) SET r.confidence=$conf",
            mid=mal_id, did=dom_id, conf=conf_high
        )
        # Domain RESOLVES_TO IP
        tx.run(
            "MATCH (d:Domain {id:$did}), (ip:IPAddress {id:$iid}) "
            "MERGE (d)-[r:RESOLVES_TO]->(ip) SET r.confidence=$conf",
            did=dom_id, iid=ip_id, conf=conf_med
        )
        # ThreatActor ATTRIBUTED_TO Incident
        tx.run(
            "MATCH (ta:ThreatActor {id:$taid}), (i:Incident {id:$eid}) "
            "MERGE (ta)-[r:ATTRIBUTED_TO]->(i) SET r.confidence=$conf",
            taid=ta_id, eid=eid, conf=conf_med
        )
        # ThreatActor DELIVERS Malware
        tx.run(
            "MATCH (ta:ThreatActor {id:$taid}), (m:Malware {id:$mid}) "
            "MERGE (ta)-[r:DELIVERS]->(m) SET r.confidence=$conf",
            taid=ta_id, mid=mal_id, conf=conf_low
        )
        # Malware TARGETS Domain (for lateral / phishing cases)
        if random.random() > 0.4:
            tx.run(
                "MATCH (m:Malware {id:$mid}), (d:Domain {id:$did}) "
                "MERGE (m)-[r:TARGETS]->(d) SET r.confidence=$conf",
                mid=mal_id, did=dom_id, conf=conf_low
            )
        # IP COMMUNICATES_WITH Domain (beacon traffic)
        tx.run(
            "MATCH (ip:IPAddress {id:$iid}), (d:Domain {id:$did}) "
            "MERGE (ip)-[r:COMMUNICATES_WITH]->(d) SET r.confidence=$conf",
            iid=ip_id, did=dom_id, conf=conf_med
        )

with driver.session() as session:
    session.execute_write(seed_graph)

print("Neo4j graph seeded:")
with driver.session() as session:
    counts = session.run("""
        CALL {
            MATCH (n:ThreatActor) RETURN 'ThreatActor' AS label, count(n) AS cnt
            UNION ALL MATCH (n:Malware)     RETURN 'Malware'     AS label, count(n) AS cnt
            UNION ALL MATCH (n:Domain)      RETURN 'Domain'      AS label, count(n) AS cnt
            UNION ALL MATCH (n:IPAddress)   RETURN 'IPAddress'   AS label, count(n) AS cnt
            UNION ALL MATCH (n:Incident)    RETURN 'Incident'    AS label, count(n) AS cnt
        }
        RETURN label, cnt
    """)
    for row in counts:
        print(f"  {row['label']:15s}: {row['cnt']}")

    rels = session.run("MATCH ()-[r]->() RETURN type(r) AS t, count(r) AS cnt")
    print("Relationships:")
    for row in rels:
        print(f"  {row['t']:25s}: {row['cnt']}")

driver.close()
mongo.close()
print("\nDone — database fully seeded.")
