"""
SentinelGraph API (v2).

Writes go to MongoDB (`sentinel_cti`, validated collections - see cti_store)
and are then projected into Neo4j. Reads that need relationships - maps,
traversals, attribution, exposure - run on Neo4j.
"""
import re
import threading
import time
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from neo4j import unit_of_work
from neo4j.exceptions import Neo4jError
from neo4j.graph import Node, Path, Relationship
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError, WriteError

import cti_store as store

router = APIRouter(prefix="/api/v2")

# Wired by main.py so this module shares its clients.
neo4j_driver = None
db = None


def init(driver, database):
    global neo4j_driver, db
    neo4j_driver = driver
    db = database
    threading.Thread(target=_warm_up, daemon=True).start()


def _warm_up():
    """Touch the store and the traversal plans once at startup so the first
    query in a demo reports warm timings instead of cold-cache ones."""
    try:
        with neo4j_driver.session() as s:
            s.run("MATCH (n) OPTIONAL MATCH (n)-[r]-() RETURN count(n), count(r)").consume()
        key = run_read("MATCH (n:Indicator) RETURN n.entityKey AS k LIMIT 1")
        if key:
            subgraph(key[0]["k"], 3, 150)
            subgraph(key[0]["k"], 2, 22, ["Malware", "IPAddress"])
        campaign_map()
    except Exception:
        pass  # warm-up is best-effort


# ---------------------------------------------------------------------------
# Schema: drives validation here and the forms in the web app
# ---------------------------------------------------------------------------
def f(name, type="text", label=None, options=None, required=False):
    return {"name": name, "type": type, "label": label or name, "options": options, "required": required}


LABELS: Dict[str, Dict[str, Any]] = {
    "ThreatActor": {"plural": "Threat Actors", "fields": [
        f("name", required=True, label="Name"), f("aliases", "list", "Aliases"), f("origin", label="Origin"),
        f("motivation", "select", "Motivation", ["espionage", "financial", "sabotage", "hacktivism"], True),
        f("sophistication", "select", "Sophistication", ["basic", "intermediate", "advanced", "expert"]),
        f("description", "textarea", "Description")]},
    "Campaign": {"plural": "Campaigns", "fields": [
        f("name", required=True, label="Name"), f("status", "select", "Status", ["active", "dormant", "concluded"], True),
        f("objective", "textarea", "Objective"), f("startedAt", "date", "Started"),
        f("sectors", "list", "Sectors"), f("regions", "list", "Regions")]},
    "Malware": {"plural": "Malware", "fields": [
        f("name", required=True, label="Name"), f("malwareType", label="Type", required=True), f("family", label="Family"),
        f("capabilities", "list", "Capabilities"), f("sha256", label="SHA-256")]},
    "Vulnerability": {"plural": "Vulnerabilities", "fields": [
        f("name", required=True, label="CVE ID"), f("product", label="Product"), f("vendor", label="Vendor"),
        f("cvss", "number", "CVSS", required=True), f("kev", "bool", "Known exploited"),
        f("patchAvailable", "bool", "Patch available"), f("published", "date", "Published"),
        f("summary", "textarea", "Summary")]},
    "Organization": {"plural": "Organizations", "fields": [
        f("name", required=True, label="Name"),
        f("sector", "select", "Sector", ["Banking", "Fintech", "Telecom", "Software Vendor", "Government", "Defence",
                                         "Pharma", "Education", "Healthcare"], True),
        f("city", label="City"), f("size", "select", "Size", ["small", "medium", "large"]),
        f("isVendor", "bool", "Software vendor")]},
    "IPAddress": {"plural": "IP Addresses", "fields": [
        f("name", required=True, label="IP address"), f("country", label="Country"), f("asn", label="ASN"),
        f("hostingProvider", label="Hosting provider"), f("firstSeen", "date", "First seen"), f("lastSeen", "date", "Last seen")]},
    "Domain": {"plural": "Domains", "fields": [
        f("name", required=True, label="Domain"), f("registrar", label="Registrar"),
        f("registeredAt", "date", "Registered"), f("firstSeen", "date", "First seen")]},
    "Email": {"plural": "Registrant e-mails", "fields": [
        f("name", required=True, label="E-mail address"), f("firstSeen", "date", "First seen")]},
    "Incident": {"plural": "Incidents", "fields": [
        f("title", required=True, label="Title"),
        f("incidentType", "select", "Type", store.INCIDENT_TYPES, True),
        f("severity", "select", "Severity", store.SEVERITIES, True),
        f("status", "select", "Status", store.INCIDENT_STATUS, True),
        f("detectedAt", "datetime", "Detected at", required=True), f("description", "textarea", "Description")]},
}
for _l, _m in LABELS.items():
    _m["collection"] = store.COLLECTION[_l]

REL_FIELDS = [f("confidence", "number", "Confidence (0-1)"), f("source", label="Source"),
              f("firstSeen", "datetime", "First seen"), f("lastSeen", "datetime", "Last seen"), f("notes", "textarea", "Notes")]

INTERNAL_LABELS = {"Entity", "Indicator"}
SEVERITY_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}
OPEN_STATUSES = ("open", "investigating")


def now() -> datetime:
    return datetime.utcnow().replace(microsecond=0)


def primary_label(labels) -> str:
    for l in labels:
        if l not in INTERNAL_LABELS:
            return l
    return "Entity"


def jsonable(v):
    if isinstance(v, (str, int, float, bool)) or v is None:
        return v
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, (list, tuple)):
        return [jsonable(x) for x in v]
    if isinstance(v, dict):
        return {k: jsonable(x) for k, x in v.items()}
    if hasattr(v, "iso_format"):
        return v.iso_format()
    if isinstance(v, Node):
        return node_out(v)
    if isinstance(v, Relationship):
        return rel_out(v)
    if isinstance(v, Path):
        return {"nodes": [node_out(n) for n in v.nodes], "relationships": [rel_out(r) for r in v.relationships]}
    return str(v)


def node_out(n: Node, **extra) -> Dict[str, Any]:
    props = {k: jsonable(v) for k, v in dict(n).items()}
    out = {
        "id": n.element_id,
        "key": props.get("entityKey") or n.element_id,
        "label": primary_label(n.labels),
        "labels": sorted(n.labels),
        "name": props.get("name") or props.get("entityKey") or "?",
        "props": props,
    }
    out.update(extra)
    return out


def rel_out(r: Relationship, **extra) -> Dict[str, Any]:
    props = {k: jsonable(v) for k, v in dict(r).items()}
    out = {
        "id": props.get("relId") or r.element_id,
        "type": r.type,
        "source": r.start_node.element_id,
        "target": r.end_node.element_id,
        "props": props,
    }
    out.update(extra)
    return out


def run_read(cypher: str, **params):
    with neo4j_driver.session() as s:
        return list(s.run(cypher, **params))


def log_activity(action: str, kind: str, label: str, key: str, summary: str):
    try:
        db.activity_log.insert_one({"id": str(uuid.uuid4()), "at": now(), "action": action, "kind": kind,
                                    "label": label, "entityKey": key, "summary": summary, "actor": "analyst"})
    except Exception:
        pass  # the activity feed is best-effort; never fail a write over it


def parse_value(fd: Optional[Dict[str, Any]], key: str, v: Any):
    if v == "" or v is None:
        return None
    t = fd["type"] if fd else None
    try:
        if t == "number":
            return float(v) if "." in str(v) else int(v)
        if t == "bool":
            return v if isinstance(v, bool) else str(v).lower() in ("true", "yes", "1")
        if t in ("date", "datetime"):
            return v if isinstance(v, datetime) else datetime.fromisoformat(str(v).replace("Z", "")[:19])
        if t == "list":
            return v if isinstance(v, list) else [x.strip() for x in str(v).split(",") if x.strip()]
    except ValueError:
        raise HTTPException(400, f"'{key}' has an invalid value")
    return v


def clean_props(fields: List[Dict[str, Any]], props: Dict[str, Any]) -> Dict[str, Any]:
    by_name = {fd["name"]: fd for fd in fields}
    out = {}
    for k, v in props.items():
        if k in ("entityKey", "_id", "type") or k.startswith("_"):
            continue
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,40}", k):
            raise HTTPException(400, f"Invalid property name '{k}'")
        out[k] = parse_value(by_name.get(k), k, v)
    return out


def mongo_error(e: Exception) -> HTTPException:
    if isinstance(e, DuplicateKeyError):
        return HTTPException(409, "A record with that name or key already exists")
    if isinstance(e, WriteError) and e.code == 121:
        details = (e.details or {}).get("errInfo", {}).get("details", {})
        fields = []
        for rule in details.get("schemaRulesNotSatisfied", []):
            for p in rule.get("propertiesNotSatisfied", []) + rule.get("missingProperties", []):
                fields.append(p.get("propertyName", p) if isinstance(p, dict) else p)
        return HTTPException(400, "Document failed schema validation" + (f": {', '.join(map(str, fields))}" if fields else ""))
    return HTTPException(500, str(e))


# ---------------------------------------------------------------------------
# Schema & search
# ---------------------------------------------------------------------------
@router.get("/schema")
def get_schema():
    return {
        "labels": [{"label": k, **v} for k, v in LABELS.items()],
        "relationships": [{"type": k, "pairs": [list(p) for p in v]} for k, v in store.RELATIONSHIPS.items()],
        "relationshipFields": REL_FIELDS,
        "collections": {name: db[name].estimated_document_count() for name in store.VALIDATORS},
    }


@router.get("/stats")
def get_stats():
    rows = run_read(
        "MATCH (n:Entity) WITH [l IN labels(n) WHERE NOT l IN ['Entity','Indicator']][0] AS label "
        "RETURN label, count(*) AS total"
    )
    labels = {l: {"count": 0, "delta": 0} for l in LABELS}
    for r in rows:
        labels[r["label"]] = {"count": r["total"], "delta": 0}
    rels = run_read("MATCH ()-[r]->() RETURN count(r) AS c")[0]["c"]
    return {"labels": labels, "nodes": sum(v["count"] for v in labels.values()), "relationships": rels}


@router.get("/search")
def search(q: str = Query(..., min_length=1), limit: int = Query(8, ge=1, le=50), label: Optional[str] = None):
    rows = run_read(
        """
        MATCH (n:Entity)
        WHERE ($label IS NULL OR $label IN labels(n))
          AND (toLower(n.name) CONTAINS toLower($q) OR toLower(n.entityKey) CONTAINS toLower($q)
               OR any(a IN coalesce(n.aliases, []) WHERE toLower(a) CONTAINS toLower($q))
               OR toLower(coalesce(n.title, '')) CONTAINS toLower($q))
        WITH n, CASE WHEN toLower(n.name) = toLower($q) OR toLower(n.entityKey) = toLower($q) THEN 0
                     WHEN toLower(n.name) STARTS WITH toLower($q) THEN 1 ELSE 2 END AS rank
        RETURN n, rank, COUNT { (n)--() } AS degree
        ORDER BY rank, degree DESC LIMIT $limit
        """,
        q=q, limit=limit, label=label,
    )
    return [node_out(r["n"], degree=r["degree"]) for r in rows]


SORTS = {"name": "n.name", "degree": "degree DESC", "recent": "n.createdAt DESC", "detected": "n.detectedAt DESC",
         "severity": "sevRank, n.detectedAt DESC"}


@router.get("/entities")
def list_entities(label: str, q: str = "", sort: str = "name",
                  skip: int = Query(0, ge=0), limit: int = Query(25, ge=1, le=200)):
    if label not in LABELS:
        raise HTTPException(400, f"Unknown label {label}")
    order = SORTS.get(sort, "n.name")
    where = ("WHERE $q = '' OR toLower(n.name) CONTAINS toLower($q) OR toLower(n.entityKey) CONTAINS toLower($q) "
             "OR toLower(coalesce(n.title,'')) CONTAINS toLower($q)")
    total = run_read(f"MATCH (n:{label}) {where} RETURN count(n) AS c", q=q)[0]["c"]
    rows = run_read(
        f"MATCH (n:{label}) {where} "
        f"WITH n, COUNT {{ (n)--() }} AS degree, "
        f"CASE n.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END AS sevRank "
        f"RETURN n, degree ORDER BY {order} SKIP $skip LIMIT $limit",
        q=q, skip=skip, limit=limit,
    )
    return {"total": total, "items": [node_out(r["n"], degree=r["degree"]) for r in rows]}


def fetch_node(key: str) -> Node:
    rows = run_read("MATCH (n:Entity {entityKey: $key}) RETURN n", key=key)
    if not rows:
        raise HTTPException(404, f"Entity {key} not found")
    return rows[0]["n"]


@router.get("/entities/{key}")
def get_entity(key: str):
    n = fetch_node(key)
    conns = run_read(
        """
        MATCH (n:Entity {entityKey: $key})-[r]-(m)
        RETURN r, m, startNode(r) = n AS outgoing, COUNT { (m)--() } AS degree
        ORDER BY type(r), m.name
        """,
        key=key,
    )
    incidents = run_read(
        """
        MATCH (n:Entity {entityKey: $key})
        MATCH (i:Incident) WHERE i <> n AND EXISTS { (n)-[*1..2]-(i) }
        RETURN DISTINCT i ORDER BY i.detectedAt DESC LIMIT 25
        """,
        key=key,
    )
    cases = list(db.cases.find({"$or": [{"campaignIds": key}, {"findings.entityKeys": key}, {"timeline.entityKeys": key}]},
                               {"_id": 1, "title": 1, "priority": 1, "status": 1}))
    return {
        "entity": node_out(n, degree=len(conns)),
        "connections": [{"relationship": rel_out(c["r"]), "direction": "out" if c["outgoing"] else "in",
                         "node": node_out(c["m"], degree=c["degree"])} for c in conns],
        "incidents": [node_out(r["i"]) for r in incidents],
        "cases": [{"id": c["_id"], **{k: v for k, v in c.items() if k != "_id"}} for c in cases],
    }


# ---------------------------------------------------------------------------
# Entity CRUD: MongoDB first, then project to Neo4j
# ---------------------------------------------------------------------------
class EntityCreate(BaseModel):
    label: str
    properties: Dict[str, Any] = Field(default_factory=dict)


class PropsPatch(BaseModel):
    properties: Dict[str, Any]


@router.post("/entities", status_code=201)
def create_entity(body: EntityCreate):
    label = body.label
    if label not in LABELS:
        raise HTTPException(400, f"Unknown label {label}")
    doc = {k: v for k, v in clean_props(LABELS[label]["fields"], body.properties).items() if v is not None}
    if label == "Incident":
        doc.setdefault("detectedAt", now())
        doc.setdefault("status", "open")
        key = store.make_key(label, "", db)
        doc["name"] = key
    else:
        if not str(doc.get("name", "")).strip():
            raise HTTPException(400, "name is required")
        doc["name"] = str(doc["name"]).strip()
        if label in store.INDICATOR_TYPE:
            doc["name"] = doc["name"].lower()
            doc["type"] = store.INDICATOR_TYPE[label]
        key = store.make_key(label, doc["name"], db)
        if label == "Vulnerability":
            if not re.fullmatch(r"CVE-\d{4}-\d{4,7}", key):
                raise HTTPException(400, "Vulnerability name must be a CVE ID like CVE-2026-1234")
            doc["name"] = key
    doc.update({"_id": key, "createdAt": now(), "updatedAt": now()})
    try:
        db[store.COLLECTION[label]].insert_one(doc)
    except Exception as e:
        raise mongo_error(e)
    with neo4j_driver.session() as s:
        store.project_node(s, label, doc)
    log_activity("create", "node", label, key, f"New {label} {doc['name']} added")
    return node_out(fetch_node(key), degree=0)


@router.patch("/entities/{key}")
def update_entity(key: str, body: PropsPatch):
    found = store.find_entity(db, key)
    if not found:
        raise HTTPException(404, f"Entity {key} not found")
    label, collection, _ = found
    props = clean_props(LABELS[label]["fields"], body.properties)
    if label == "Incident" or "name" in props and not props["name"]:
        props.pop("name", None)
    sets = {k: v for k, v in props.items() if v is not None}
    unsets = {k: "" for k, v in props.items() if v is None}
    sets["updatedAt"] = now()
    try:
        db[collection].update_one({"_id": key}, {"$set": sets, **({"$unset": unsets} if unsets else {})})
    except Exception as e:
        raise mongo_error(e)
    doc = db[collection].find_one({"_id": key})
    with neo4j_driver.session() as s:
        store.project_node(s, label, doc)
    log_activity("update", "node", label, key, f"{label} {doc.get('name', key)} updated")
    return node_out(fetch_node(key))


@router.delete("/entities/{key}")
def delete_entity(key: str):
    found = store.find_entity(db, key)
    if not found:
        raise HTTPException(404, f"Entity {key} not found")
    label, collection, doc = found
    removed = db.relationships.delete_many({"$or": [{"from": key}, {"to": key}]}).deleted_count
    db[collection].delete_one({"_id": key})
    with neo4j_driver.session() as s:
        store.unproject_node(s, key)
    log_activity("delete", "node", label, key, f"{label} {doc.get('name', key)} deleted")
    return {"deleted": key, "relationshipsRemoved": removed}


# ---------------------------------------------------------------------------
# Relationship CRUD (the `relationships` collection)
# ---------------------------------------------------------------------------
class RelCreate(BaseModel):
    type: str
    source: str
    target: str
    properties: Dict[str, Any] = Field(default_factory=dict)


def clean_rel(props: Dict[str, Any]) -> Dict[str, Any]:
    out = clean_props(REL_FIELDS, props)
    c = out.get("confidence")
    if c is not None:
        out["confidence"] = float(c)
        if not 0 <= out["confidence"] <= 1:
            raise HTTPException(400, "confidence must be between 0 and 1")
    return out


@router.post("/relationships", status_code=201)
def create_relationship(body: RelCreate):
    if body.type not in store.RELATIONSHIPS:
        raise HTTPException(400, f"Unknown relationship type {body.type}")
    a, b = store.find_entity(db, body.source), store.find_entity(db, body.target)
    if not a or not b:
        raise HTTPException(404, "Both entities must exist")
    if (a[0], b[0]) not in store.RELATIONSHIPS[body.type]:
        allowed = ", ".join(f"{x} → {y}" for x, y in store.RELATIONSHIPS[body.type])
        raise HTTPException(400, f"{body.type} cannot connect {a[0]} → {b[0]}. Allowed: {allowed}")
    props = {k: v for k, v in clean_rel(body.properties).items() if v is not None}
    doc = {"_id": store.rel_key(body.type, body.source, body.target), "type": body.type, "from": body.source,
           "to": body.target, "fromLabel": a[0], "toLabel": b[0], "confidence": 0.8, "source": "analyst",
           "firstSeen": now(), **props, "createdAt": now(), "updatedAt": now()}
    try:
        db.relationships.insert_one(doc)
    except Exception as e:
        raise mongo_error(e)
    with neo4j_driver.session() as s:
        store.project_relationship(s, doc)
    log_activity("create", "relationship", body.type, body.source,
                 f"{a[2]['name']} linked to {b[2]['name']} ({body.type})")
    return {"id": doc["_id"], "type": body.type, "props": store.rel_props(doc)}


@router.patch("/relationships/{rel_id}")
def update_relationship(rel_id: str, body: PropsPatch):
    props = clean_rel(body.properties)
    sets = {k: v for k, v in props.items() if v is not None}
    unsets = {k: "" for k, v in props.items() if v is None}
    sets["updatedAt"] = now()
    try:
        res = db.relationships.update_one({"_id": rel_id}, {"$set": sets, **({"$unset": unsets} if unsets else {})})
    except Exception as e:
        raise mongo_error(e)
    if not res.matched_count:
        raise HTTPException(404, "Relationship not found")
    doc = db.relationships.find_one({"_id": rel_id})
    with neo4j_driver.session() as s:
        store.project_relationship(s, doc)
    log_activity("update", "relationship", doc["type"], doc["from"], f"{doc['from']} → {doc['to']} ({doc['type']}) updated")
    return {"id": rel_id, "type": doc["type"], "props": store.rel_props(doc)}


@router.delete("/relationships/{rel_id}")
def delete_relationship(rel_id: str):
    doc = db.relationships.find_one_and_delete({"_id": rel_id})
    if not doc:
        raise HTTPException(404, "Relationship not found")
    with neo4j_driver.session() as s:
        store.unproject_relationship(s, rel_id)
    log_activity("delete", "relationship", doc["type"], doc["from"], f"{doc['from']} unlinked from {doc['to']} ({doc['type']})")
    return {"deleted": rel_id}


# ---------------------------------------------------------------------------
# Campaign map: one swim-lane per campaign, shared infrastructure in between
# ---------------------------------------------------------------------------
COLUMN = {"ThreatActor": 0, "Campaign": 1, "Malware": 2, "Vulnerability": 2, "Domain": 3,
          "IPAddress": 4, "Email": 4, "Organization": 5}
MAP_EDGES = {"RUNS", "USES", "EXPLOITS", "TARGETS", "CONTACTS", "RESOLVES_TO", "REGISTERED_BY", "SUPPLIES"}


def load_graph():
    with neo4j_driver.session() as s:
        nodes = {r["n"].element_id: r["n"] for r in s.run("MATCH (n:Entity) RETURN n")}
        rels = [r["r"] for r in s.run("MATCH ()-[r]->() RETURN r")]
    return nodes, rels


def membership(nodes, rels):
    """Which campaign(s) each entity belongs to, derived from the evidence links."""
    out_by = {}
    for r in rels:
        out_by.setdefault((r.start_node.element_id, r.type), []).append(r.end_node.element_id)
    in_by = {}
    for r in rels:
        in_by.setdefault((r.end_node.element_id, r.type), []).append(r.start_node.element_id)

    camps = {nid: n for nid, n in nodes.items() if "Campaign" in n.labels}
    member: Dict[str, set] = {}
    incidents_of: Dict[str, List[str]] = {}
    exposed: Dict[str, set] = {}  # campaign -> orgs exposed to its CVEs
    for cid in camps:
        m = {cid}
        m.update(in_by.get((cid, "RUNS"), []))
        tools = out_by.get((cid, "USES"), [])
        vulns = out_by.get((cid, "EXPLOITS"), [])
        m.update(tools)
        m.update(vulns)
        m.update(out_by.get((cid, "TARGETS"), []))
        exposed[cid] = {o for v in vulns for o in in_by.get((v, "EXPOSED_TO"), [])}
        m.update(exposed[cid])
        infra = {i for t in tools for i in out_by.get((t, "CONTACTS"), [])}
        incs = in_by.get((cid, "ATTRIBUTED_TO"), [])
        incidents_of[cid] = incs
        for i in incs:
            infra.update(out_by.get((i, "OBSERVED"), []))
        for dom in list(infra):
            infra.update(out_by.get((dom, "RESOLVES_TO"), []))
            infra.update(out_by.get((dom, "REGISTERED_BY"), []))
        m.update(infra)
        for nid in m:
            member.setdefault(nid, set()).add(cid)
    return camps, member, incidents_of, exposed, out_by, in_by


@router.get("/map")
def campaign_map(campaigns: Optional[str] = None):
    t0 = time.perf_counter()
    nodes, rels = load_graph()
    camps, member, incidents_of, exposed, out_by, in_by = membership(nodes, rels)
    wanted = set(campaigns.split(",")) if campaigns else None
    key_of = {nid: n["entityKey"] for nid, n in nodes.items()}
    if wanted:
        camps = {cid: c for cid, c in camps.items() if c["entityKey"] in wanted}

    # Lane per campaign; entities in more than one campaign get a shared lane
    lanes: Dict[str, Dict[str, Any]] = {}
    for cid, c in camps.items():
        actor = next((nodes[a]["name"] for a in in_by.get((cid, "RUNS"), [])), None)
        lanes[cid] = {"id": c["entityKey"], "kind": "campaign", "title": c["name"],
                      "subtitle": f"{actor} · {c.get('status', '')}" if actor else c.get("status", ""),
                      "campaigns": [c["entityKey"]], "status": c.get("status")}
    lane_of: Dict[str, str] = {}
    for nid, cs in member.items():
        cs = cs & set(camps)
        if not cs:
            continue
        if len(cs) == 1:
            lane_of[nid] = next(iter(cs))
        else:
            lid = "shared:" + "+".join(sorted(key_of[c] for c in cs))
            lanes.setdefault(lid, {"id": lid, "kind": "shared",
                                   "title": "Shared: " + " & ".join(nodes[c]["name"] for c in sorted(cs, key=lambda c: nodes[c]["name"])),
                                   "subtitle": "Infrastructure and tooling used by more than one campaign",
                                   "campaigns": sorted(key_of[c] for c in cs)})
            lane_of[nid] = lid

    # Order: independent campaigns, then each shared lane sandwiched by its campaigns
    order: List[str] = []
    shared = [l for l in lanes.values() if l["kind"] == "shared"]
    paired = {k for l in shared for k in l["campaigns"]}
    by_key = {l["id"]: cid for cid, l in lanes.items() if l["kind"] == "campaign"}
    for cid, l in lanes.items():
        if l["kind"] == "campaign" and l["id"] not in paired:
            order.append(cid)
    for l in shared:
        a, b = l["campaigns"][0], l["campaigns"][-1]
        for k in (a,):
            if by_key[k] not in order:
                order.append(by_key[k])
        order.append(l["id"])
        if by_key[b] not in order:
            order.append(by_key[b])
    # put dormant/background campaigns last
    order.sort(key=lambda lid: 1 if lanes[lid].get("status") == "dormant" else 0)

    # Org status inside each lane: hit / exposed / targeted
    inc_nodes = {nid: n for nid, n in nodes.items() if "Incident" in n.labels}
    out_nodes, edges = [], []
    for nid, lid in lane_of.items():
        n = nodes[nid]
        label = primary_label(n.labels)
        if label not in COLUMN:
            continue
        extra: Dict[str, Any] = {"lane": lanes[lid]["id"], "col": COLUMN[label]}
        if label == "Organization":
            lane_camps = [c for c in camps if camps[c]["entityKey"] in lanes[lid]["campaigns"]]
            hits = [inc_nodes[i] for c in lane_camps for i in incidents_of.get(c, [])
                    if nid in out_by.get((i, "AFFECTED"), [])]
            unattributed = [inc_nodes[i] for i in in_by.get((nid, "AFFECTED"), [])
                            if i in inc_nodes and not out_by.get((i, "ATTRIBUTED_TO"))]
            is_exposed = any(nid in exposed.get(c, set()) for c in lane_camps)
            if hits:
                worst = min(hits, key=lambda i: SEVERITY_RANK.get(i.get("severity"), 9))
                open_n = sum(1 for i in hits if i.get("status") in OPEN_STATUSES)
                extra["badge"] = {"text": f"{len(hits)} incident{'s' if len(hits) > 1 else ''}" + (f" · {open_n} open" if open_n else ""),
                                  "tone": worst.get("severity")}
                extra["status"] = "hit"
            elif is_exposed:
                extra["badge"] = {"text": "exposed · " + ("suspicious activity" if unattributed else "not hit yet"),
                                  "tone": "warning"}
                extra["status"] = "exposed"
            else:
                extra["status"] = "targeted"
        out_nodes.append(node_out(n, **extra))
    kept = {n["id"] for n in out_nodes}
    for r in rels:
        if r.type in MAP_EDGES and r.start_node.element_id in kept and r.end_node.element_id in kept:
            edges.append(rel_out(r))
    return {"lanes": [lanes[l] for l in order], "nodes": out_nodes, "edges": edges,
            "ms": round((time.perf_counter() - t0) * 1000, 1)}


# ---------------------------------------------------------------------------
# Overview, attention queue and cases
# ---------------------------------------------------------------------------
def campaign_stats(nodes, camps, incidents_of, exposed, out_by):
    stats = {}
    for cid, c in camps.items():
        incs = [nodes[i] for i in incidents_of.get(cid, [])]
        victims = {o for i in incidents_of.get(cid, []) for o in out_by.get((i, "AFFECTED"), [])}
        open_incs = [i for i in incs if i.get("status") in OPEN_STATUSES]
        stats[c["entityKey"]] = {
            "incidents": len(incs), "open": len(open_incs),
            "critical": sum(1 for i in open_incs if i.get("severity") == "critical"),
            "victims": len(victims), "exposedNotHit": len(exposed.get(cid, set()) - victims),
            "lastActivity": max((i.get("detectedAt", "") for i in incs), default=None),
        }
    return stats


@router.get("/overview")
def overview():
    nodes, rels = load_graph()
    camps, member, incidents_of, exposed, out_by, in_by = membership(nodes, rels)
    incs = [n for n in nodes.values() if "Incident" in n.labels]
    open_incs = [i for i in incs if i.get("status") in OPEN_STATUSES]
    hit_orgs = {o for nid, n in nodes.items() if "Incident" in n.labels for o in out_by.get((nid, "AFFECTED"), [])}
    # exposed to a campaign's CVE but no incident from that campaign yet
    exposed_unhit = set()
    for cid, orgs in exposed.items():
        victims = {o for i in incidents_of.get(cid, []) for o in out_by.get((i, "AFFECTED"), [])}
        exposed_unhit |= orgs - victims
    attributed = {i for v in incidents_of.values() for i in v}
    return {
        "kpis": {
            "activeCampaigns": sum(1 for c in camps.values() if c.get("status") == "active"),
            "openIncidents": len(open_incs),
            "criticalOpen": sum(1 for i in open_incs if i.get("severity") == "critical"),
            "orgsAffected": len(hit_orgs),
            "exposedNotHit": len(exposed_unhit),
            "unattributed": sum(1 for nid, n in nodes.items() if "Incident" in n.labels and nid not in attributed
                                and n.get("status") in OPEN_STATUSES),
        },
        "campaigns": campaign_stats(nodes, camps, incidents_of, exposed, out_by),
    }


@router.get("/attention")
def attention():
    """What an analyst should look at next, each item explained by graph evidence."""
    nodes, rels = load_graph()
    camps, member, incidents_of, exposed, out_by, in_by = membership(nodes, rels)
    attributed = {i for v in incidents_of.values() for i in v}
    name = lambda nid: nodes[nid]["name"]
    key = lambda nid: nodes[nid]["entityKey"]
    items = []

    # 1. Unattributed incidents whose indicators belong to a known campaign
    for nid, n in nodes.items():
        if "Incident" not in n.labels or nid in attributed or n.get("status") not in OPEN_STATUSES:
            continue
        for ind in out_by.get((nid, "OBSERVED"), []):
            cs = sorted(member.get(ind, set()) & set(camps), key=name)
            if cs:
                org = next(iter(out_by.get((nid, "AFFECTED"), [])), None)
                items.append({
                    "kind": "attribution", "severity": n.get("severity"),
                    "title": f"{n['name']} looks like {' or '.join(name(c) for c in cs)}",
                    "detail": f"{n.get('title')} at {name(org) if org else '?'} observed {name(ind)}, "
                              f"which is {'shared ' if len(cs) > 1 else ''}{' / '.join(name(c) for c in cs)} infrastructure.",
                    "entityKeys": [n["entityKey"], key(ind)] + [key(c) for c in cs],
                    "focus": n["entityKey"], "path": [n["entityKey"], key(cs[0])]})
                break

    # 2. Organizations exposed to an active campaign's CVE but not hit yet
    for cid, orgs in exposed.items():
        if camps[cid].get("status") != "active":
            continue
        victims = {o for i in incidents_of.get(cid, []) for o in out_by.get((i, "AFFECTED"), [])}
        cves = [v for v in out_by.get((cid, "EXPLOITS"), [])]
        for o in sorted(orgs - victims, key=name):
            cve = next(v for v in cves if o in in_by.get((v, "EXPOSED_TO"), []))
            suspicious = [i for i in in_by.get((o, "AFFECTED"), []) if i not in attributed
                          and nodes[i].get("status") in OPEN_STATUSES]
            items.append({
                "kind": "exposure", "severity": "high" if suspicious else "medium",
                "title": f"{name(o)} is exposed to {name(cid)}",
                "detail": f"Runs a product vulnerable to {name(cve)}, which {name(cid)} is actively exploiting."
                          + (" Already showing suspicious activity." if suspicious else " No incident yet: patch first."),
                "entityKeys": [key(o), key(cve), key(cid)], "focus": key(o), "path": [key(o), key(cid)]})

    # 3. Infrastructure shared between campaigns, one item per campaign pair
    overlaps: Dict[tuple, List[str]] = {}
    for nid, cs in member.items():
        cs = cs & set(camps)
        if len(cs) > 1 and primary_label(nodes[nid].labels) in ("IPAddress", "Domain", "Email", "Malware"):
            overlaps.setdefault(tuple(sorted(cs, key=name)), []).append(nid)
    for cs, shared in overlaps.items():
        names = [name(c) for c in cs]
        items.append({
            "kind": "overlap", "severity": "high",
            "title": f"{' and '.join(names)} share {len(shared)} indicators",
            "detail": ", ".join(sorted(name(n) for n in shared)) + ". Separate campaigns reusing infrastructure "
                      "usually means shared operators or access being sold between groups.",
            "entityKeys": [key(n) for n in shared] + [key(c) for c in cs], "focus": key(shared[0]),
            "path": [key(cs[0]), key(cs[-1])]})

    # 4. Open critical incidents
    for nid, n in nodes.items():
        if "Incident" in n.labels and n.get("severity") == "critical" and n.get("status") in OPEN_STATUSES:
            org = next(iter(out_by.get((nid, "AFFECTED"), [])), None)
            camp = next(iter(out_by.get((nid, "ATTRIBUTED_TO"), [])), None)
            items.append({
                "kind": "critical", "severity": "critical",
                "title": f"{n['name']}: {n.get('title')}",
                "detail": f"{name(org) if org else '?'}{' · ' + name(camp) if camp else ''} · {n.get('status')}",
                "entityKeys": [n["entityKey"]], "focus": n["entityKey"]})

    kind_rank = {"attribution": 0, "exposure": 1, "overlap": 2, "critical": 3}
    items.sort(key=lambda i: (kind_rank[i["kind"]], SEVERITY_RANK.get(i["severity"], 9)))
    return items


def case_out(c: Dict[str, Any], stats=None) -> Dict[str, Any]:
    out = jsonable({k: v for k, v in c.items() if k != "_id"})
    out["id"] = c["_id"]
    if stats is not None:
        s = [stats[k] for k in c.get("campaignIds", []) if k in stats]
        out["stats"] = {
            "incidents": sum(x["incidents"] for x in s), "open": sum(x["open"] for x in s),
            "critical": sum(x["critical"] for x in s), "victims": sum(x["victims"] for x in s),
            "exposedNotHit": sum(x["exposedNotHit"] for x in s),
            "lastActivity": max((x["lastActivity"] for x in s if x["lastActivity"]), default=None),
        }
    return out


@router.get("/cases")
def list_cases():
    nodes, rels = load_graph()
    camps, member, incidents_of, exposed, out_by, in_by = membership(nodes, rels)
    stats = campaign_stats(nodes, camps, incidents_of, exposed, out_by)
    names = {c["entityKey"]: {"name": c["name"], "actor": next((nodes[a]["name"] for a in in_by.get((cid, "RUNS"), [])), None)}
             for cid, c in camps.items()}
    order = {"P1": 0, "P2": 1, "P3": 2}
    cases = sorted(db.cases.find({}, {"timeline": 0}), key=lambda c: (order[c["priority"]], c["status"] != "open", -c["updatedAt"].timestamp()))
    out = []
    for c in cases:
        o = case_out(c, stats)
        o["campaigns"] = [{"key": k, **names.get(k, {"name": k})} for k in c.get("campaignIds", [])]
        out.append(o)
    return out


@router.get("/cases/{case_id}")
def get_case(case_id: str):
    c = db.cases.find_one({"_id": case_id})
    if not c:
        raise HTTPException(404, "Case not found")
    nodes, rels = load_graph()
    camps, member, incidents_of, exposed, out_by, in_by = membership(nodes, rels)
    stats = campaign_stats(nodes, camps, incidents_of, exposed, out_by)
    out = case_out(c, stats)
    by_key = {n["entityKey"]: n for n in nodes.values()}
    keys = {k for part in ("findings", "timeline") for e in c.get(part, []) for k in e.get("entityKeys", [])}
    keys.update(c.get("campaignIds", []))
    out["entities"] = {k: node_out(by_key[k]) for k in keys if k in by_key}
    out["campaigns"] = [{"key": k, "name": by_key[k]["name"] if k in by_key else k} for k in c.get("campaignIds", [])]
    return out


class CasePatch(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    owner: Optional[str] = None
    recommendations: Optional[List[Dict[str, Any]]] = None


@router.patch("/cases/{case_id}")
def update_case(case_id: str, body: CasePatch):
    sets = {k: v for k, v in body.model_dump().items() if v is not None}
    if not sets:
        raise HTTPException(400, "Nothing to update")
    sets["updatedAt"] = now()
    try:
        res = db.cases.update_one({"_id": case_id}, {"$set": sets})
    except Exception as e:
        raise mongo_error(e)
    if not res.matched_count:
        raise HTTPException(404, "Case not found")
    log_activity("update", "case", "Case", case_id, f"Case {case_id} updated")
    return get_case(case_id)


class CaseNote(BaseModel):
    text: str
    entityKeys: List[str] = Field(default_factory=list)


@router.post("/cases/{case_id}/notes", status_code=201)
def add_case_note(case_id: str, body: CaseNote):
    if not body.text.strip():
        raise HTTPException(400, "Note text is required")
    entry = {"at": now(), "title": "Analyst note", "detail": body.text.strip(), "entityKeys": body.entityKeys, "note": True}
    res = db.cases.update_one({"_id": case_id}, {"$push": {"timeline": entry}, "$set": {"updatedAt": now()}})
    if not res.matched_count:
        raise HTTPException(404, "Case not found")
    log_activity("note", "case", "Case", case_id, f"Note added to {case_id}")
    return get_case(case_id)


@router.get("/activity")
def activity(limit: int = Query(8, ge=1, le=50)):
    docs = list(db.activity_log.find({}, {"_id": 0}).sort("at", -1).limit(limit))
    for d in docs:
        d["at"] = d["at"].isoformat() + "Z" if isinstance(d.get("at"), datetime) else d.get("at")
    return docs


# ---------------------------------------------------------------------------
# Graph traversal
# ---------------------------------------------------------------------------
def subgraph(key: str, depth: int, limit: int, labels: Optional[List[str]] = None, cross: bool = True):
    """BFS tree around an entity: every node is reached by its shortest path,
    so each node gets a hop distance and a single 'tree' parent edge. Edges
    between kept nodes that are not on a shortest path come back as 'cross'."""
    depth = max(1, min(depth, 4))
    cypher = (
        "MATCH (origin:Entity {entityKey: $key})\n"
        "MATCH (n:Entity) WHERE n <> origin\n"
        f"MATCH p = shortestPath((origin)-[*..{depth}]-(n))\n"
        "RETURN n, length(p) AS hops, last(relationships(p)) AS via"
    )
    # With a type filter the whole route must stay inside the allowed types. A
    # path predicate makes shortestPath exhaustive (seconds), so expand level by
    # level instead: same BFS semantics, one indexed query per hop.
    frontier_cypher = (
        "MATCH (a)-[r]-(n:Entity) WHERE elementId(a) IN $frontier AND NOT elementId(n) IN $seen\n"
        "  AND any(l IN labels(n) WHERE l IN $labels)\n"
        "RETURN n, r"
    )
    t0 = time.perf_counter()
    found = []  # (node, hops, parent relationship)
    with neo4j_driver.session() as s:
        origin = s.run("MATCH (n:Entity {entityKey: $key}) RETURN n, COUNT { (n)--() } AS degree", key=key).single()
        if not origin:
            raise HTTPException(404, f"Entity {key} not found")
        if labels:
            seen, frontier = {origin["n"].element_id}, [origin["n"].element_id]
            for hop in range(1, depth + 1):
                nxt = []
                for rec in s.run(frontier_cypher, frontier=frontier, seen=list(seen), labels=labels):
                    nid = rec["n"].element_id
                    if nid not in seen:
                        seen.add(nid)
                        nxt.append(nid)
                        found.append((rec["n"], hop, rec["r"]))
                if not nxt:
                    break
                frontier = nxt
        else:
            found = [(r["n"], r["hops"], r["via"]) for r in s.run(cypher, key=key)]
        ms = (time.perf_counter() - t0) * 1000

        degrees = {r["id"]: r["d"] for r in s.run(
            "MATCH (n) WHERE elementId(n) IN $ids RETURN elementId(n) AS id, COUNT { (n)--() } AS d",
            ids=[n.element_id for n, _, _ in found])}

    reached = len(found)
    # Nearest first, hubs first within a hop. Parents are always one hop closer,
    # so a prefix of this order never strands a node without its parent.
    found.sort(key=lambda t: (t[1], -degrees.get(t[0].element_id, 0)))
    found = found[:limit]

    nodes: Dict[str, Dict[str, Any]] = {origin["n"].element_id: node_out(origin["n"], hop=0, degree=origin["degree"])}
    edges: Dict[str, Dict[str, Any]] = {}
    for n, hops, via in found:
        nodes[n.element_id] = node_out(n, hop=hops, degree=degrees.get(n.element_id, 0))
    for n, hops, via in found:
        if via is not None and via.start_node.element_id in nodes and via.end_node.element_id in nodes:
            edges.setdefault(via.element_id, rel_out(via, kind="tree"))

    if cross and len(nodes) > 1:
        with neo4j_driver.session() as s:
            for rec in s.run("MATCH (a)-[r]->(b) WHERE elementId(a) IN $ids AND elementId(b) IN $ids RETURN r",
                             ids=list(nodes)):
                edges.setdefault(rec["r"].element_id, rel_out(rec["r"], kind="cross"))

    return {
        "center": nodes[origin["n"].element_id],
        "nodes": list(nodes.values()),
        "edges": list(edges.values()),
        "reached": reached,
        "truncated": reached > len(found),
        "cypher": frontier_cypher if labels else cypher.replace("$key", f"'{key}'"),
        "ms": round(ms, 1),
    }


@router.get("/graph/neighborhood/{key}")
def neighborhood(key: str, depth: int = Query(1, ge=1, le=3), limit: int = Query(40, ge=1, le=300),
                 labels: Optional[str] = None, cross: bool = True):
    return subgraph(key, depth, limit, labels.split(",") if labels else None, cross)


@router.get("/graph/blast-radius/{key}")
def blast_radius(key: str, depth: int = Query(3, ge=1, le=4), limit: int = Query(150, ge=1, le=400)):
    g = subgraph(key, depth, limit)
    by_label: Dict[str, int] = {}
    by_hop: Dict[int, int] = {}
    for n in g["nodes"]:
        if n["hop"] == 0:
            continue
        by_label[n["label"]] = by_label.get(n["label"], 0) + 1
        by_hop[n["hop"]] = by_hop.get(n["hop"], 0) + 1
    pick = lambda l: sorted([n for n in g["nodes"] if n["label"] == l and n["hop"] > 0],
                            key=lambda n: (n["hop"], SEVERITY_RANK.get(n["props"].get("severity"), 9)))
    g["summary"] = {
        "byLabel": by_label,
        "byHop": {str(k): v for k, v in sorted(by_hop.items())},
        "organizations": pick("Organization"),
        "incidents": pick("Incident")[:30],
        "actors": pick("ThreatActor"),
        "campaigns": pick("Campaign"),
    }
    return g


@router.get("/graph/path")
def shortest_path(source: str, target: str, max_hops: int = Query(6, ge=1, le=8)):
    cypher = (
        "MATCH (a:Entity {entityKey: $source}), (b:Entity {entityKey: $target})\n"
        f"MATCH p = allShortestPaths((a)-[*..{max_hops}]-(b))\n"
        "RETURN p LIMIT 6"
    )
    t0 = time.perf_counter()
    rows = run_read(cypher, source=source, target=target)
    ms = (time.perf_counter() - t0) * 1000
    if not rows:
        fetch_node(source)
        fetch_node(target)
        return {"nodes": [], "edges": [], "paths": 0, "length": None, "cypher": cypher, "ms": round(ms, 1)}
    nodes: Dict[str, Dict[str, Any]] = {}
    edges: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        p: Path = r["p"]
        for i, n in enumerate(p.nodes):
            nodes.setdefault(n.element_id, node_out(n, hop=i))
        for rel in p.relationships:
            edges.setdefault(rel.element_id, rel_out(rel, kind="tree"))
    return {"nodes": list(nodes.values()), "edges": list(edges.values()), "paths": len(rows),
            "length": len(rows[0]["p"].relationships),
            "cypher": cypher.replace("$source", f"'{source}'").replace("$target", f"'{target}'"),
            "ms": round(ms, 1)}


# ---------------------------------------------------------------------------
# Read-only Cypher console
# ---------------------------------------------------------------------------
class CypherRequest(BaseModel):
    query: str
    params: Dict[str, Any] = Field(default_factory=dict)


@router.post("/cypher")
def run_cypher(body: CypherRequest):
    nodes: Dict[str, Dict[str, Any]] = {}
    edges: Dict[str, Dict[str, Any]] = {}
    starts: List[str] = []  # first node of every returned path, used to lay results out by hop

    def harvest(v):
        if isinstance(v, Node):
            nodes.setdefault(v.element_id, node_out(v))
        elif isinstance(v, Relationship):
            edges.setdefault(v.element_id, rel_out(v))
            for n in (v.start_node, v.end_node):
                if n is not None and n.element_id not in nodes and len(n.labels):
                    nodes[n.element_id] = node_out(n)
        elif isinstance(v, Path):
            if v.start_node.element_id not in starts:
                starts.append(v.start_node.element_id)
            for n in v.nodes:
                harvest(n)
            for r in v.relationships:
                harvest(r)
        elif isinstance(v, (list, tuple)):
            for x in v:
                harvest(x)
        elif isinstance(v, dict):
            for x in v.values():
                harvest(x)

    @unit_of_work(timeout=15)
    def work(tx):
        res = tx.run(body.query, **body.params)
        recs = list(res)
        return res.keys(), recs

    t0 = time.perf_counter()
    try:
        with neo4j_driver.session(default_access_mode="READ") as s:
            keys, recs = s.execute_read(work)
    except Neo4jError as e:
        msg = e.message or str(e)
        if "write" in msg.lower() and "read" in msg.lower():
            msg = "The query console is read-only. Use the entity screens to create, edit or delete data."
        raise HTTPException(400, msg)
    ms = (time.perf_counter() - t0) * 1000
    recs = recs[:500]
    rows = []
    for rec in recs:
        rows.append([jsonable(rec[k]) for k in keys])
        for k in keys:
            harvest(rec[k])
    # Pull in edges between returned nodes so the graph view is connected
    if nodes:
        for rec in run_read("MATCH (a)-[r]->(b) WHERE elementId(a) IN $ids AND elementId(b) IN $ids RETURN r",
                            ids=list(nodes)):
            edges.setdefault(rec["r"].element_id, rel_out(rec["r"], kind="cross"))
    return {"columns": list(keys), "rows": rows,
            "graph": {"nodes": list(nodes.values()), "edges": list(edges.values()), "starts": starts},
            "ms": round(ms, 1), "count": len(rows)}


# ---------------------------------------------------------------------------
# Graph Data Science analytics
# ---------------------------------------------------------------------------
GDS_GRAPH = "sg-analytics"


def _project(s, orientation: str):
    s.run("CALL gds.graph.drop($g, false) YIELD graphName RETURN graphName", g=GDS_GRAPH).consume()
    rel_proj = {"ALL": {"type": "*", "orientation": orientation, "properties": {"confidence": {"defaultValue": 0.5}}}}
    s.run("CALL gds.graph.project($g, 'Entity', $rels) YIELD graphName RETURN graphName",
          g=GDS_GRAPH, rels=rel_proj).consume()


@router.get("/insights/breakdown")
def breakdown():
    out = {}
    for field in ("severity", "incidentType", "status"):
        rows = run_read(f"MATCH (i:Incident) RETURN i.{field} AS k, count(*) AS c ORDER BY c DESC")
        out[field] = {str(r["k"]): r["c"] for r in rows}
    rows = run_read("MATCH (o:Organization)<-[:AFFECTED]-(i:Incident) RETURN o.sector AS k, count(i) AS c ORDER BY c DESC")
    out["sector"] = {str(r["k"]): r["c"] for r in rows}
    return out


@router.post("/analytics/pagerank")
def pagerank(damping: float = 0.85, iterations: int = 20, limit: int = 15):
    t0 = time.perf_counter()
    try:
        with neo4j_driver.session() as s:
            _project(s, "UNDIRECTED")
            stats = s.run(
                "CALL gds.pageRank.stream($g, {maxIterations: $it, dampingFactor: $d, "
                "relationshipWeightProperty: 'confidence'}) YIELD nodeId, score "
                "WITH gds.util.asNode(nodeId) AS n, score WHERE NOT n:Incident "
                "RETURN n, score, COUNT { (n)--() } AS degree ORDER BY score DESC LIMIT $l",
                g=GDS_GRAPH, it=iterations, d=damping, l=limit)
            top = list(stats)
            s.run("CALL gds.graph.drop($g, false) YIELD graphName RETURN graphName", g=GDS_GRAPH).consume()
    except Neo4jError as e:
        raise HTTPException(500, f"Graph Data Science error: {e.message}")
    return {"algorithm": "PageRank", "ms": round((time.perf_counter() - t0) * 1000, 1),
            "nodesWritten": 0, "iterations": iterations,
            "top": [node_out(r["n"], degree=r["degree"], score=r["score"]) for r in top]}


@router.post("/analytics/communities")
def communities(limit: int = 8):
    t0 = time.perf_counter()
    try:
        with neo4j_driver.session() as s:
            _project(s, "UNDIRECTED")
            rows = list(s.run(
                "CALL gds.leiden.stream($g, {relationshipWeightProperty: 'confidence', randomSeed: 42}) "
                "YIELD nodeId, communityId RETURN gds.util.asNode(nodeId) AS n, communityId", g=GDS_GRAPH))
            s.run("CALL gds.graph.drop($g, false) YIELD graphName RETURN graphName", g=GDS_GRAPH).consume()
            degrees = {r["k"]: r["d"] for r in s.run("MATCH (n:Entity) RETURN n.entityKey AS k, COUNT { (n)--() } AS d")}
    except Neo4jError as e:
        raise HTTPException(500, f"Graph Data Science error: {e.message}")
    groups: Dict[int, List[Node]] = {}
    for r in rows:
        groups.setdefault(r["communityId"], []).append(r["n"])
    out = []
    for cid, members in sorted(groups.items(), key=lambda kv: -len(kv[1]))[:limit]:
        members.sort(key=lambda n: -degrees.get(n["entityKey"], 0))
        has = lambda l: [m["name"] for m in members if l in m.labels]
        out.append({"id": cid, "size": len(members), "hubs": [node_out(m) for m in members[:6]],
                    "actors": has("ThreatActor"), "campaigns": has("Campaign"), "organizations": has("Organization"),
                    "incidents": len(has("Incident"))})
    return {"algorithm": "Leiden", "ms": round((time.perf_counter() - t0) * 1000, 1),
            "communityCount": len(groups), "modularity": 0.0, "communities": out}
