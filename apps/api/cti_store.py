"""
SentinelGraph CTI storage layer.

MongoDB database `sentinel_cti` is the system of record. Each kind of thing
lives in its own validated collection, the way a student portal keeps
students, courses and enrollments apart:

  threat_actors    who is attacking                     (_id  TA-<SLUG>)
  campaigns        a coordinated operation by an actor  (_id  CMP-<SLUG>)
  malware          tools and payloads                   (_id  MAL-<SLUG>)
  vulnerabilities  CVEs being exploited                 (_id  CVE-YYYY-NNNN)
  organizations    victims, vendors, exposed assets     (_id  ORG-<SLUG>)
  indicators       IPs, domains, registrant e-mails     (_id  ip:<v> | domain:<v> | email:<v>)
  incidents        what actually happened to whom       (_id  INC-<NNNN>)
  relationships    every evidence-backed link between two records ("enrollments")
  cases            analyst case files: findings, timeline, recommendations
  activity_log     audit trail of every change

Neo4j holds a projection of the first eight collections (nodes + links) and
is where multi-hop questions get answered. Every write goes to MongoDB first
and is then projected, so the two never disagree.
"""
import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional

DB_NAME = "sentinel_cti"

# label -> collection
COLLECTION = {
    "ThreatActor": "threat_actors",
    "Campaign": "campaigns",
    "Malware": "malware",
    "Vulnerability": "vulnerabilities",
    "Organization": "organizations",
    "IPAddress": "indicators",
    "Domain": "indicators",
    "Email": "indicators",
    "Incident": "incidents",
}
INDICATOR_TYPE = {"IPAddress": "ip", "Domain": "domain", "Email": "email"}
LABEL_OF_INDICATOR = {v: k for k, v in INDICATOR_TYPE.items()}

# (relationship type) -> allowed (from label, to label) pairs
RELATIONSHIPS: Dict[str, List[tuple]] = {
    "RUNS":          [("ThreatActor", "Campaign")],
    "USES":          [("Campaign", "Malware")],
    "EXPLOITS":      [("Campaign", "Vulnerability")],
    "TARGETS":       [("Campaign", "Organization")],
    "CONTACTS":      [("Malware", "IPAddress"), ("Malware", "Domain")],
    "RESOLVES_TO":   [("Domain", "IPAddress")],
    "REGISTERED_BY": [("Domain", "Email")],
    "AFFECTED":      [("Incident", "Organization")],
    "OBSERVED":      [("Incident", "IPAddress"), ("Incident", "Domain"), ("Incident", "Email")],
    "INVOLVED":      [("Incident", "Malware")],
    "ATTRIBUTED_TO": [("Incident", "Campaign")],
    "EXPOSED_TO":    [("Organization", "Vulnerability")],
    "SUPPLIES":      [("Organization", "Organization")],
}

SEVERITIES = ["low", "medium", "high", "critical"]
INCIDENT_TYPES = ["Phishing", "Credential Theft", "Fraud", "Malware", "C2 Beaconing", "Supply Chain", "Intrusion",
                  "Exploit Attempt", "Lateral Movement", "Ransomware", "Data Exfiltration", "Data Leak",
                  "Network Scan", "DDoS", "Defacement"]
INCIDENT_STATUS = ["open", "investigating", "contained", "closed"]


def _s(**kw):
    return {"bsonType": "string", **kw}


DATE = {"bsonType": "date"}
STR_LIST = {"bsonType": "array", "items": {"bsonType": "string"}}
NUM = {"bsonType": ["double", "int", "long"]}
AUDIT = {"createdAt": DATE, "updatedAt": DATE}

VALIDATORS: Dict[str, Dict[str, Any]] = {
    "threat_actors": {
        "required": ["_id", "name", "motivation"],
        "properties": {"_id": _s(pattern="^TA-"), "name": _s(), "aliases": STR_LIST, "origin": _s(),
                       "motivation": {"enum": ["espionage", "financial", "sabotage", "hacktivism"]},
                       "sophistication": {"enum": ["basic", "intermediate", "advanced", "expert"]},
                       "description": _s(), **AUDIT}},
    "campaigns": {
        "required": ["_id", "name", "status"],
        "properties": {"_id": _s(pattern="^CMP-"), "name": _s(), "objective": _s(),
                       "status": {"enum": ["active", "dormant", "concluded"]}, "startedAt": DATE,
                       "sectors": STR_LIST, "regions": STR_LIST, **AUDIT}},
    "malware": {
        "required": ["_id", "name", "malwareType"],
        "properties": {"_id": _s(pattern="^MAL-"), "name": _s(), "family": _s(), "malwareType": _s(),
                       "capabilities": STR_LIST, "sha256": _s(pattern="^[0-9a-f]{64}$"), **AUDIT}},
    "vulnerabilities": {
        "required": ["_id", "name", "cvss"],
        "properties": {"_id": _s(pattern=r"^CVE-\d{4}-\d{4,7}$"), "name": _s(), "product": _s(), "vendor": _s(),
                       "cvss": {**NUM, "minimum": 0, "maximum": 10}, "kev": {"bsonType": "bool"},
                       "patchAvailable": {"bsonType": "bool"}, "published": DATE, "summary": _s(), **AUDIT}},
    "organizations": {
        "required": ["_id", "name", "sector"],
        "properties": {"_id": _s(pattern="^ORG-"), "name": _s(), "sector": _s(), "city": _s(),
                       "size": {"enum": ["small", "medium", "large"]}, "isVendor": {"bsonType": "bool"}, **AUDIT}},
    "indicators": {
        "required": ["_id", "type", "name"],
        "properties": {"_id": _s(pattern="^(ip|domain|email):"), "type": {"enum": ["ip", "domain", "email"]},
                       "name": _s(), "country": _s(), "asn": _s(), "hostingProvider": _s(), "registrar": _s(),
                       "registeredAt": DATE, "firstSeen": DATE, "lastSeen": DATE, **AUDIT}},
    "incidents": {
        "required": ["_id", "name", "title", "incidentType", "severity", "status", "detectedAt"],
        "properties": {"_id": _s(pattern="^INC-"), "name": _s(), "title": _s(), "incidentType": {"enum": INCIDENT_TYPES},
                       "severity": {"enum": SEVERITIES}, "status": {"enum": INCIDENT_STATUS}, "detectedAt": DATE,
                       "description": _s(), **AUDIT}},
    "relationships": {
        "required": ["_id", "type", "from", "to", "fromLabel", "toLabel", "confidence"],
        "properties": {"_id": _s(), "type": {"enum": list(RELATIONSHIPS)}, "from": _s(), "to": _s(),
                       "fromLabel": _s(), "toLabel": _s(), "confidence": {**NUM, "minimum": 0, "maximum": 1},
                       "source": _s(), "firstSeen": DATE, "lastSeen": DATE, "notes": _s(), **AUDIT}},
    "cases": {
        "required": ["_id", "title", "priority", "status", "owner", "openedAt"],
        "properties": {"_id": _s(pattern="^CASE-"), "title": _s(), "priority": {"enum": ["P1", "P2", "P3"]},
                       "status": {"enum": ["open", "monitoring", "closed"]}, "owner": _s(), "campaignIds": STR_LIST,
                       "openedAt": DATE, "summary": _s(),
                       "findings": {"bsonType": "array", "items": {"bsonType": "object", "required": ["title"]}},
                       "timeline": {"bsonType": "array", "items": {"bsonType": "object", "required": ["at", "title"]}},
                       "recommendations": {"bsonType": "array", "items": {"bsonType": "object", "required": ["text", "done"]}},
                       **AUDIT}},
    "activity_log": {
        "required": ["at", "action", "summary"],
        "properties": {"at": DATE, "action": {"enum": ["create", "update", "delete", "note"]}, "summary": _s()}},
}

INDEXES = {
    "threat_actors": [([("name", 1)], {"unique": True})],
    "campaigns": [([("name", 1)], {"unique": True}), ([("status", 1)], {})],
    "malware": [([("name", 1)], {"unique": True})],
    "organizations": [([("name", 1)], {"unique": True}), ([("sector", 1)], {})],
    "indicators": [([("type", 1), ("name", 1)], {"unique": True})],
    "incidents": [([("detectedAt", -1)], {}), ([("severity", 1), ("status", 1)], {})],
    "relationships": [([("from", 1), ("type", 1)], {}), ([("to", 1), ("type", 1)], {})],
    "cases": [([("status", 1), ("priority", 1)], {})],
    "activity_log": [([("at", -1)], {})],
}


def ensure_collections(db):
    """Create every collection with its $jsonSchema validator (or refresh it) and its indexes."""
    existing = set(db.list_collection_names())
    for name, schema in VALIDATORS.items():
        validator = {"$jsonSchema": {"bsonType": "object", **schema}}
        if name in existing:
            db.command("collMod", name, validator=validator, validationLevel="strict")
        else:
            db.create_collection(name, validator=validator, validationLevel="strict")
        for keys, opts in INDEXES.get(name, []):
            db[name].create_index(keys, **opts)


# ---------------------------------------------------------------------------
# Keys
# ---------------------------------------------------------------------------
PREFIX = {"ThreatActor": "TA-", "Campaign": "CMP-", "Malware": "MAL-", "Organization": "ORG-"}


def slug(name: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "-", name.upper()).strip("-")[:32]


def make_key(label: str, name: str, db=None) -> str:
    if label in PREFIX:
        return PREFIX[label] + slug(name)
    if label in INDICATOR_TYPE:
        return f"{INDICATOR_TYPE[label]}:{name.strip().lower()}"
    if label == "Vulnerability":
        return name.strip().upper()
    if label == "Incident":
        last = db.incidents.find_one({}, sort=[("_id", -1)]) if db is not None else None
        n = int(last["_id"].split("-")[1]) + 1 if last else 1000
        return f"INC-{n}"
    raise ValueError(label)


def rel_key(rtype: str, src: str, dst: str) -> str:
    return f"{rtype}|{src}|{dst}"


def label_of(doc: Dict[str, Any], collection: str) -> str:
    if collection == "indicators":
        return LABEL_OF_INDICATOR[doc["type"]]
    return next(l for l, c in COLLECTION.items() if c == collection)


# ---------------------------------------------------------------------------
# Projection into Neo4j
# ---------------------------------------------------------------------------
def _graph_value(v):
    if isinstance(v, datetime):
        return v.replace(microsecond=0).isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return v


def node_props(doc: Dict[str, Any]) -> Dict[str, Any]:
    props = {k: _graph_value(v) for k, v in doc.items() if k not in ("_id", "type") and v is not None}
    props["entityKey"] = doc["_id"]
    return props


def node_labels(label: str) -> str:
    return ":".join(["Entity", label] + (["Indicator"] if label in INDICATOR_TYPE else []))


def project_node(session, label: str, doc: Dict[str, Any]):
    session.run(
        f"MERGE (n:{node_labels(label)} {{entityKey: $key}}) SET n = $props",
        key=doc["_id"], props=node_props(doc),
    ).consume()


def unproject_node(session, key: str):
    session.run("MATCH (n:Entity {entityKey: $key}) DETACH DELETE n", key=key).consume()


def rel_props(doc: Dict[str, Any]) -> Dict[str, Any]:
    props = {k: _graph_value(v) for k, v in doc.items()
             if k not in ("_id", "type", "from", "to", "fromLabel", "toLabel") and v is not None}
    props["relId"] = doc["_id"]
    return props


def project_relationship(session, doc: Dict[str, Any]):
    session.run(
        f"MATCH (a:Entity {{entityKey: $from}}), (b:Entity {{entityKey: $to}}) "
        f"MERGE (a)-[r:{doc['type']} {{relId: $id}}]->(b) SET r = $props",
        **{"from": doc["from"], "to": doc["to"], "id": doc["_id"], "props": rel_props(doc)},
    ).consume()


def unproject_relationship(session, rel_id: str):
    session.run("MATCH ()-[r {relId: $id}]->() DELETE r", id=rel_id).consume()


def rebuild_graph(db, driver):
    """Wipe the Neo4j projection and rebuild it from MongoDB."""
    with driver.session() as s:
        s.run("MATCH (n) DETACH DELETE n").consume()
        s.run("CREATE CONSTRAINT entity_key_unique IF NOT EXISTS FOR (e:Entity) REQUIRE e.entityKey IS UNIQUE").consume()
        s.run("CREATE INDEX entity_name_idx IF NOT EXISTS FOR (e:Entity) ON (e.name)").consume()
        s.run("CREATE INDEX rel_id_idx IF NOT EXISTS FOR ()-[r:OBSERVED]-() ON (r.relId)").consume()
        for collection in ("threat_actors", "campaigns", "malware", "vulnerabilities", "organizations",
                           "indicators", "incidents"):
            by_label: Dict[str, List[Dict[str, Any]]] = {}
            for doc in db[collection].find():
                by_label.setdefault(label_of(doc, collection), []).append(node_props(doc))
            for label, rows in by_label.items():
                s.run(f"UNWIND $rows AS row CREATE (n:{node_labels(label)}) SET n = row", rows=rows).consume()
        by_type: Dict[str, List[Dict[str, Any]]] = {}
        for doc in db.relationships.find():
            by_type.setdefault(doc["type"], []).append({"from": doc["from"], "to": doc["to"], "props": rel_props(doc)})
        for rtype, rows in by_type.items():
            s.run(
                f"UNWIND $rows AS row MATCH (a:Entity {{entityKey: row.from}}), (b:Entity {{entityKey: row.to}}) "
                f"CREATE (a)-[r:{rtype}]->(b) SET r = row.props",
                rows=rows,
            ).consume()
        nodes = s.run("MATCH (n) RETURN count(n) AS c").single()["c"]
        rels = s.run("MATCH ()-[r]->() RETURN count(r) AS c").single()["c"]
    return nodes, rels


def find_entity(db, key: str) -> Optional[tuple]:
    """(label, collection, doc) for an entity key, or None."""
    for collection in ("threat_actors", "campaigns", "malware", "vulnerabilities", "organizations",
                       "indicators", "incidents"):
        doc = db[collection].find_one({"_id": key})
        if doc:
            return label_of(doc, collection), collection, doc
    return None
