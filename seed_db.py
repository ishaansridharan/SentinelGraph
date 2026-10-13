"""
Seed the `sentinel_cti` MongoDB database with the SentinelGraph scenario and
project it into Neo4j.

The story (all names fictional; IPs from RFC 5737 documentation ranges,
domains on reserved .example / .invalid / .test TLDs, CVE IDs synthetic):

  Monsoon Ledger  CrimsonFox runs fake "KYC update" lures against Indian
                  retail banks and a UPI fintech; FoxStealer steals logins and
                  forwards OTPs.
  Silent Courier  APT-Saffron compromises payroll vendor LedgerSoft and ships a
                  trojanized update to its government, defence, pharma and
                  university customers (supply-chain attack).
  Code Blue       BlackLotus exploits an EdgeGate VPN flaw to ransom hospitals.
  Banner Drop     ScarletWasp hacktivist DDoS - unrelated background noise.

  The hidden link: Monsoon Ledger and Code Blue share a bulletproof staging IP,
  a BeaconX C2 domain and a domain registrant - CrimsonFox is selling bank
  network access to BlackLotus (an initial-access broker).

  Who's next: five hospitals are exposed to the EdgeGate CVE; two are hit, one
  blocked an attempt, and Green Valley is already talking to the staging IP.

Run:  python seed_db.py
"""
import hashlib
import os
import sys
import uuid
from datetime import datetime, timedelta

from neo4j import GraphDatabase
from pymongo import MongoClient

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "apps", "api"))
import cti_store as store  # noqa: E402

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:3032/?replicaSet=rs0")
NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://localhost:3033")
NEO4J_AUTH = ("neo4j", "password")


def d(s: str) -> datetime:
    return datetime.fromisoformat(s)


def sha(name: str) -> str:
    return hashlib.sha256(f"sentinelgraph-synthetic-{name}".encode()).hexdigest()


# ---------------------------------------------------------------------------
# Entities
# ---------------------------------------------------------------------------
ACTORS = [
    {"_id": "TA-CRIMSONFOX", "name": "CrimsonFox", "aliases": ["Red Vixen", "TA-552"], "origin": "Eastern Europe",
     "motivation": "financial", "sophistication": "intermediate",
     "description": "Financially motivated crew running KYC-fraud phishing against Indian retail banking. Also sells the network access it gains to other groups."},
    {"_id": "TA-APT-SAFFRON", "name": "APT-Saffron", "aliases": ["Saffron Typhoon"], "origin": "South Asia",
     "motivation": "espionage", "sophistication": "advanced",
     "description": "State-aligned espionage group known for software supply-chain intrusions into government and defence suppliers."},
    {"_id": "TA-BLACKLOTUS", "name": "BlackLotus", "aliases": ["Lotus Panda", "LotusLocker affiliates"], "origin": "Unknown",
     "motivation": "financial", "sophistication": "advanced",
     "description": "Ransomware-as-a-service operation hitting hospitals through unpatched edge VPNs. Buys initial access from brokers."},
    {"_id": "TA-SCARLETWASP", "name": "ScarletWasp", "aliases": ["Wasp Nest"], "origin": "Unknown",
     "motivation": "hacktivism", "sophistication": "basic",
     "description": "Hacktivist collective running DDoS and defacement against government portals around national events."},
]

CAMPAIGNS = [
    {"_id": "CMP-MONSOON-LEDGER", "name": "Monsoon Ledger", "status": "active", "startedAt": d("2026-07-08"),
     "objective": "Steal net-banking and UPI credentials through fake KYC-update lures", "sectors": ["Banking", "Fintech"], "regions": ["IN"]},
    {"_id": "CMP-SILENT-COURIER", "name": "Silent Courier", "status": "active", "startedAt": d("2026-06-20"),
     "objective": "Backdoor government and defence networks through a trojanized LedgerSoft payroll update",
     "sectors": ["Government", "Defence", "Pharma", "Education"], "regions": ["IN"]},
    {"_id": "CMP-CODE-BLUE", "name": "Code Blue", "status": "active", "startedAt": d("2026-08-25"),
     "objective": "Encrypt hospital systems for ransom after exploiting EdgeGate VPN gateways", "sectors": ["Healthcare"], "regions": ["IN"]},
    {"_id": "CMP-BANNER-DROP", "name": "Banner Drop", "status": "dormant", "startedAt": d("2026-08-10"),
     "objective": "DDoS and deface government portals during national events", "sectors": ["Government"], "regions": ["IN"]},
]
RUNS = [("TA-CRIMSONFOX", "CMP-MONSOON-LEDGER"), ("TA-APT-SAFFRON", "CMP-SILENT-COURIER"),
        ("TA-BLACKLOTUS", "CMP-CODE-BLUE"), ("TA-SCARLETWASP", "CMP-BANNER-DROP")]

MALWARE = [
    ("MAL-KYCKIT", "KYCKit", "phishing kit", ["credential harvesting", "OTP interception"]),
    ("MAL-FOXSTEALER", "FoxStealer", "infostealer", ["browser credential theft", "SMS OTP forwarding"]),
    ("MAL-BEACONX", "BeaconX", "post-exploitation", ["command and control", "lateral movement"]),
    ("MAL-COURIERUPDATE", "CourierUpdate", "trojanized installer", ["signed-update abuse", "dropper"]),
    ("MAL-DARKLOADER", "DarkLoader", "loader", ["persistence", "payload delivery"]),
    ("MAL-SAFFRONRAT", "SaffronRAT", "remote access trojan", ["keylogging", "file exfiltration"]),
    ("MAL-LOTUSDROP", "LotusDrop", "loader", ["VPN exploit delivery", "staging"]),
    ("MAL-LOTUSLOCKER", "LotusLocker", "ransomware", ["encryption", "data-leak extortion"]),
    ("MAL-WASPNET", "WaspNet", "botnet", ["DDoS"]),
]
USES = {
    "CMP-MONSOON-LEDGER": ["MAL-KYCKIT", "MAL-FOXSTEALER", "MAL-BEACONX"],
    "CMP-SILENT-COURIER": ["MAL-COURIERUPDATE", "MAL-DARKLOADER", "MAL-SAFFRONRAT"],
    "CMP-CODE-BLUE": ["MAL-LOTUSDROP", "MAL-BEACONX", "MAL-LOTUSLOCKER"],
    "CMP-BANNER-DROP": ["MAL-WASPNET"],
}

VULNS = [
    ("CVE-2026-1101", "EdgeGate VPN", "EdgeGate", 9.8, True, "2026-08-02", "Pre-authentication remote code execution in the VPN web portal."),
    ("CVE-2026-1188", "RemoteDesk Server", "RemoteDesk", 8.8, True, "2026-07-15", "Authentication bypass used for lateral movement."),
    ("CVE-2026-0942", "LedgerSoft Payroll Updater", "LedgerSoft", 8.1, True, "2026-07-10", "Update-signature validation bypass that lets a lookalike server push code."),
    ("CVE-2026-0730", "OfficeDoc Parser", "OfficeDoc", 7.8, False, "2026-05-28", "Memory corruption when opening crafted documents."),
    ("CVE-2026-1350", "SwiftPay Android SDK", "SwiftPay", 7.4, False, "2026-06-30", "WebView overlay flaw abused to capture banking credentials."),
    ("CVE-2026-0615", "GovCMS Portal", "GovCMS", 6.5, False, "2026-04-11", "Stored XSS allowing page defacement."),
]
EXPLOITS = {
    "CMP-MONSOON-LEDGER": ["CVE-2026-1350"],
    "CMP-SILENT-COURIER": ["CVE-2026-0942", "CVE-2026-0730"],
    "CMP-CODE-BLUE": ["CVE-2026-1101", "CVE-2026-1188"],
    "CMP-BANNER-DROP": ["CVE-2026-0615"],
}

ORGS = [
    ("ORG-BANK-OF-DECCAN", "Bank of Deccan", "Banking", "Hyderabad", "large", False),
    ("ORG-KONKAN-CO-OPERATIVE-BANK", "Konkan Co-operative Bank", "Banking", "Mumbai", "medium", False),
    ("ORG-PAYKARO", "PayKaro", "Fintech", "Bengaluru", "medium", False),
    ("ORG-SIGNALONE-TELECOM", "SignalOne Telecom", "Telecom", "Delhi", "large", False),
    ("ORG-LEDGERSOFT", "LedgerSoft", "Software Vendor", "Pune", "medium", True),
    ("ORG-DEPT-OF-COASTAL-LOGISTICS", "Dept. of Coastal Logistics", "Government", "Visakhapatnam", "large", False),
    ("ORG-ORION-DEFENCE-SYSTEMS", "Orion Defence Systems", "Defence", "Bengaluru", "large", False),
    ("ORG-MERIDIAN-PHARMA", "Meridian Pharma", "Pharma", "Ahmedabad", "large", False),
    ("ORG-HELIX-UNIVERSITY", "Helix University", "Education", "Vellore", "large", False),
    ("ORG-CITYCARE-HOSPITAL", "CityCare Hospital", "Healthcare", "Chennai", "large", False),
    ("ORG-LAKEVIEW-MEDICAL-CENTRE", "Lakeview Medical Centre", "Healthcare", "Kochi", "medium", False),
    ("ORG-SUNRISE-CHILDREN-S-HOSPITAL", "Sunrise Children's Hospital", "Healthcare", "Pune", "medium", False),
    ("ORG-GREEN-VALLEY-MEDICAL-COLLEGE", "Green Valley Medical College", "Healthcare", "Coimbatore", "large", False),
    ("ORG-ST-ANNE-S-CLINIC", "St. Anne's Clinic", "Healthcare", "Mangaluru", "small", False),
    ("ORG-NATIONAL-E-SERVICES-PORTAL", "National e-Services Portal", "Government", "Delhi", "large", False),
    ("ORG-SMART-CITY-MISSION-OFFICE", "Smart City Mission Office", "Government", "Surat", "small", False),
]
O = {o[1]: o[0] for o in ORGS}
TARGETS = {
    "CMP-MONSOON-LEDGER": ["Bank of Deccan", "Konkan Co-operative Bank", "PayKaro", "SignalOne Telecom"],
    "CMP-SILENT-COURIER": ["LedgerSoft", "Dept. of Coastal Logistics", "Orion Defence Systems", "Meridian Pharma", "Helix University"],
    "CMP-CODE-BLUE": ["CityCare Hospital", "Lakeview Medical Centre", "Sunrise Children's Hospital"],
    "CMP-BANNER-DROP": ["National e-Services Portal", "Smart City Mission Office"],
}
# Asset-scan results: which organizations run a vulnerable product
EXPOSED_TO = {
    "CVE-2026-1101": ["CityCare Hospital", "Lakeview Medical Centre", "Sunrise Children's Hospital",
                      "Green Valley Medical College", "St. Anne's Clinic"],
    "CVE-2026-1188": ["CityCare Hospital", "Green Valley Medical College"],
    "CVE-2026-0942": ["Dept. of Coastal Logistics", "Orion Defence Systems", "Meridian Pharma", "Helix University"],
    "CVE-2026-1350": ["Bank of Deccan", "PayKaro"],
    "CVE-2026-0615": ["National e-Services Portal"],
}
SUPPLIES = [("LedgerSoft", c) for c in ["Dept. of Coastal Logistics", "Orion Defence Systems", "Meridian Pharma", "Helix University"]]

# Indicators: (type, value, attributes)
INDICATORS = [
    # Monsoon Ledger phishing infrastructure
    ("domain", "kyc-update-deccan.example", {"registrar": "NameSilo-Sim", "registeredAt": d("2026-07-01")}),
    ("domain", "deccan-ekyc.invalid", {"registrar": "NameSilo-Sim", "registeredAt": d("2026-07-02")}),
    ("domain", "deccan-rewards.example", {"registrar": "Porkbun-Sim", "registeredAt": d("2026-08-20")}),
    ("domain", "paykaro-verify.example", {"registrar": "NameSilo-Sim", "registeredAt": d("2026-07-25")}),
    ("domain", "konkan-kyc.test", {"registrar": "Porkbun-Sim", "registeredAt": d("2026-08-12")}),
    ("ip", "203.0.113.10", {"country": "NL", "asn": "AS64501", "hostingProvider": "FlyHost-Sim"}),
    ("ip", "203.0.113.11", {"country": "NL", "asn": "AS64501", "hostingProvider": "FlyHost-Sim"}),
    ("ip", "198.51.100.23", {"country": "MD", "asn": "AS64505", "hostingProvider": "Cheap-VPS-Sim"}),
    # Shared between Monsoon Ledger and Code Blue (the access-broker link)
    ("ip", "198.51.100.77", {"country": "SC", "asn": "AS64510", "hostingProvider": "Bulletproof-7"}),
    ("domain", "cdn-sync.example", {"registrar": "Epik-Sim", "registeredAt": d("2026-06-15")}),
    ("email", "reg.admin@mailbox.invalid", {}),
    # Silent Courier
    ("domain", "updates.ledgersoft-cdn.example", {"registrar": "Hostinger-Sim", "registeredAt": d("2026-06-10")}),
    ("domain", "telemetry-ledger.invalid", {"registrar": "Hostinger-Sim", "registeredAt": d("2026-06-11")}),
    ("ip", "192.0.2.44", {"country": "SG", "asn": "AS64520", "hostingProvider": "CloudNine-Sim"}),
    ("ip", "192.0.2.45", {"country": "SG", "asn": "AS64520", "hostingProvider": "CloudNine-Sim"}),
    ("ip", "203.0.113.90", {"country": "HK", "asn": "AS64522", "hostingProvider": "HarbourHost-Sim"}),
    ("email", "it.desk@protonmail.invalid", {}),
    # Code Blue
    ("ip", "198.51.100.140", {"country": "RU", "asn": "AS64530", "hostingProvider": "ScanNet-Sim"}),
    ("ip", "198.51.100.141", {"country": "RU", "asn": "AS64530", "hostingProvider": "ScanNet-Sim"}),
    ("ip", "198.51.100.150", {"country": "SC", "asn": "AS64510", "hostingProvider": "Bulletproof-7"}),
    ("domain", "lotus-support.invalid", {"registrar": "Epik-Sim", "registeredAt": d("2026-08-22")}),
    # Banner Drop
    ("ip", "192.0.2.200", {"country": "TR", "asn": "AS64540", "hostingProvider": "Residential botnet"}),
    ("ip", "192.0.2.201", {"country": "BR", "asn": "AS64541", "hostingProvider": "Residential botnet"}),
    ("domain", "wasp-nest.test", {"registrar": "Namecheap-Sim", "registeredAt": d("2026-08-01")}),
]
CONTACTS = {
    "MAL-KYCKIT": ["kyc-update-deccan.example", "deccan-ekyc.invalid", "deccan-rewards.example", "paykaro-verify.example", "konkan-kyc.test"],
    "MAL-FOXSTEALER": ["198.51.100.23", "198.51.100.77"],
    "MAL-BEACONX": ["cdn-sync.example"],
    "MAL-COURIERUPDATE": ["updates.ledgersoft-cdn.example"],
    "MAL-DARKLOADER": ["telemetry-ledger.invalid"],
    "MAL-SAFFRONRAT": ["203.0.113.90"],
    "MAL-LOTUSDROP": ["198.51.100.141", "198.51.100.77"],
    "MAL-LOTUSLOCKER": ["lotus-support.invalid"],
    "MAL-WASPNET": ["192.0.2.200", "192.0.2.201", "wasp-nest.test"],
}
RESOLVES_TO = [
    ("kyc-update-deccan.example", "203.0.113.10"), ("deccan-ekyc.invalid", "203.0.113.10"),
    ("deccan-rewards.example", "203.0.113.10"), ("paykaro-verify.example", "203.0.113.11"),
    ("konkan-kyc.test", "203.0.113.11"), ("cdn-sync.example", "198.51.100.77"),
    ("updates.ledgersoft-cdn.example", "192.0.2.44"), ("telemetry-ledger.invalid", "192.0.2.45"),
    ("lotus-support.invalid", "198.51.100.150"), ("wasp-nest.test", "192.0.2.200"),
]
REGISTERED_BY = [
    ("deccan-ekyc.invalid", "reg.admin@mailbox.invalid"), ("cdn-sync.example", "reg.admin@mailbox.invalid"),
    ("lotus-support.invalid", "reg.admin@mailbox.invalid"),
    ("updates.ledgersoft-cdn.example", "it.desk@protonmail.invalid"), ("telemetry-ledger.invalid", "it.desk@protonmail.invalid"),
]

# Incidents: id, title, type, severity, status, detected, org, campaign (None = unattributed), observed, malware, description
M, C, B, W = "CMP-MONSOON-LEDGER", "CMP-SILENT-COURIER", "CMP-CODE-BLUE", "CMP-BANNER-DROP"
INCIDENTS = [
    # Monsoon Ledger
    ("INC-2401", "Customers report fake KYC-update SMS", "Phishing", "medium", "closed", "2026-07-09 10:20", "Bank of Deccan", M, ["kyc-update-deccan.example"], "MAL-KYCKIT",
     "Over 300 customers forwarded an SMS asking them to 'update KYC or account will be blocked' with a link to a lookalike domain."),
    ("INC-2402", "Lookalike KYC portal impersonating Bank of Deccan", "Phishing", "high", "contained", "2026-07-11 14:05", "Bank of Deccan", M, ["kyc-update-deccan.example", "203.0.113.10"], "MAL-KYCKIT",
     "Pixel-perfect clone of the net-banking login hosted on FlyHost; takedown requested."),
    ("INC-2405", "Credential replay against net-banking", "Credential Theft", "high", "closed", "2026-07-19 02:40", "Bank of Deccan", M, ["198.51.100.23"], "MAL-FOXSTEALER",
     "Burst of logins with valid credentials from a single VPS range."),
    ("INC-2409", "SMS gateway abused to send KYC lures", "Phishing", "medium", "closed", "2026-07-24 09:00", "SignalOne Telecom", M, ["paykaro-verify.example"], "MAL-KYCKIT",
     "A compromised bulk-SMS reseller account pushed 40,000 lure messages."),
    ("INC-2411", "PayKaro users redirected to fake verify page", "Phishing", "high", "contained", "2026-08-02 18:30", "PayKaro", M, ["paykaro-verify.example", "203.0.113.11"], "MAL-KYCKIT",
     "Users asked to 're-verify UPI PIN' on a cloned page."),
    ("INC-2414", "Fraudulent UPI transfers after OTP forwarding", "Fraud", "critical", "investigating", "2026-08-09 23:10", "PayKaro", M, ["198.51.100.23"], "MAL-FOXSTEALER",
     "FoxStealer on victims' phones forwarded OTPs; Rs 38 lakh moved to mule accounts in 6 hours."),
    ("INC-2418", "KYC lure campaign against Konkan Bank customers", "Phishing", "medium", "contained", "2026-08-18 11:45", "Konkan Co-operative Bank", M, ["konkan-kyc.test"], "MAL-KYCKIT",
     "Same lure template, new domain, now targeting a co-operative bank."),
    ("INC-2421", "Malicious 'Deccan KYC' APK installed by customers", "Malware", "high", "investigating", "2026-08-27 16:00", "Bank of Deccan", M, ["deccan-ekyc.invalid"], "MAL-FOXSTEALER",
     "Sideloaded Android app abusing the SwiftPay SDK overlay flaw to capture credentials."),
    ("INC-2427", "Stealer traffic from a branch workstation", "C2 Beaconing", "high", "investigating", "2026-09-06 08:15", "Konkan Co-operative Bank", M, ["198.51.100.77"], "MAL-FOXSTEALER",
     "First FoxStealer infection inside a bank network rather than on a customer device."),
    ("INC-2433", "Bank staff credentials listed for sale", "Data Leak", "critical", "open", "2026-09-18 12:00", "Bank of Deccan", M, ["198.51.100.77"], "MAL-FOXSTEALER",
     "Broker post offering 'VPN + AD access to an Indian bank', panel hosted on 198.51.100.77."),
    ("INC-2440", "BeaconX implant on Bank of Deccan jump host", "C2 Beaconing", "critical", "open", "2026-09-29 03:20", "Bank of Deccan", M, ["cdn-sync.example"], "MAL-BEACONX",
     "Hands-on-keyboard access: the sold access is being used."),
    ("INC-2446", "New KYC lure wave ahead of Diwali", "Phishing", "medium", "open", "2026-10-08 19:00", "PayKaro", M, ["deccan-rewards.example"], "MAL-KYCKIT",
     "Festive 'reward points' theme, same kit and hosting."),
    # Silent Courier
    ("INC-2301", "LedgerSoft build server accessed from unknown IP", "Intrusion", "high", "closed", "2026-06-22 01:30", "LedgerSoft", C, ["192.0.2.44"], "MAL-COURIERUPDATE",
     "Attacker added a lookalike update URL to the release pipeline."),
    ("INC-2304", "Payroll update 4.2.1 pulled from lookalike CDN", "Supply Chain", "high", "contained", "2026-06-30 10:00", "Dept. of Coastal Logistics", C, ["updates.ledgersoft-cdn.example"], "MAL-COURIERUPDATE",
     "Auto-update fetched a signed-looking package from ledgersoft-cdn.example."),
    ("INC-2306", "DarkLoader beacon from finance laptop", "C2 Beaconing", "high", "contained", "2026-07-03 15:40", "Dept. of Coastal Logistics", C, ["telemetry-ledger.invalid", "192.0.2.45"], "MAL-DARKLOADER",
     "Hourly HTTPS beacon disguised as payroll telemetry."),
    ("INC-2310", "Trojanized payroll update installed", "Supply Chain", "high", "contained", "2026-07-08 09:10", "Orion Defence Systems", C, ["updates.ledgersoft-cdn.example"], "MAL-COURIERUPDATE",
     "Same package hash as the Coastal Logistics install."),
    ("INC-2312", "SaffronRAT exfiltrating design documents", "Data Exfiltration", "critical", "investigating", "2026-07-21 22:50", "Orion Defence Systems", C, ["203.0.113.90"], "MAL-SAFFRONRAT",
     "1.2 GB of CAD files staged and sent out over two nights."),
    ("INC-2316", "Weaponised payroll circular sent to HR", "Phishing", "medium", "closed", "2026-07-29 11:00", "Orion Defence Systems", C, [], "MAL-SAFFRONRAT",
     "OfficeDoc exploit used to re-enter after the first cleanup."),
    ("INC-2319", "Trojanized update on HR servers", "Supply Chain", "medium", "contained", "2026-08-05 13:30", "Meridian Pharma", C, ["updates.ledgersoft-cdn.example"], "MAL-COURIERUPDATE",
     "Found during a vendor-advisory sweep."),
    ("INC-2322", "DarkLoader persistence found during audit", "Malware", "high", "investigating", "2026-08-20 17:20", "Meridian Pharma", C, ["telemetry-ledger.invalid"], "MAL-DARKLOADER",
     "Scheduled task survived the update rollback."),
    ("INC-2325", "Payroll update beacon from campus admin office", "C2 Beaconing", "medium", "contained", "2026-09-02 10:05", "Helix University", C, ["192.0.2.45"], "MAL-DARKLOADER",
     "University was a late adopter of the poisoned update."),
    ("INC-2329", "Second-stage RAT on research server", "Malware", "high", "open", "2026-09-25 21:15", "Helix University", C, ["203.0.113.90"], "MAL-SAFFRONRAT",
     "Defence-funded research lab - matches APT-Saffron's interests."),
    # Code Blue
    ("INC-2501", "Mass scanning of EdgeGate VPN portals", "Network Scan", "low", "closed", "2026-08-26 04:00", "Sunrise Children's Hospital", B, ["198.51.100.140"], None,
     "Internet-wide scan for the EdgeGate version banner."),
    ("INC-2503", "EdgeGate exploitation attempt blocked", "Exploit Attempt", "medium", "closed", "2026-08-28 04:30", "Sunrise Children's Hospital", B, ["198.51.100.141"], "MAL-LOTUSDROP",
     "WAF virtual patch blocked the exploit; VPN itself still unpatched."),
    ("INC-2505", "VPN compromise and LotusDrop staging", "Intrusion", "high", "contained", "2026-09-03 02:10", "CityCare Hospital", B, ["198.51.100.141", "198.51.100.77"], "MAL-LOTUSDROP",
     "Exploit succeeded; loader pulled tools from 198.51.100.77."),
    ("INC-2507", "BeaconX lateral movement via RemoteDesk", "Lateral Movement", "high", "contained", "2026-09-05 01:00", "CityCare Hospital", B, ["cdn-sync.example"], "MAL-BEACONX",
     "RemoteDesk auth bypass used to reach the radiology and billing servers."),
    ("INC-2509", "LotusLocker encrypts radiology and billing", "Ransomware", "critical", "contained", "2026-09-07 05:45", "CityCare Hospital", B, ["lotus-support.invalid"], "MAL-LOTUSLOCKER",
     "Emergency department diverted ambulances for 14 hours."),
    ("INC-2512", "Patient records posted on leak site", "Data Leak", "critical", "investigating", "2026-09-15 12:00", "CityCare Hospital", B, ["lotus-support.invalid"], "MAL-LOTUSLOCKER",
     "Sample of 8,000 patient records published to pressure payment."),
    ("INC-2516", "EdgeGate VPN exploited at Lakeview", "Intrusion", "high", "investigating", "2026-10-02 03:30", "Lakeview Medical Centre", B, ["198.51.100.140", "198.51.100.77"], "MAL-LOTUSDROP",
     "Same exploit chain and staging IP as CityCare, four weeks later."),
    ("INC-2518", "BeaconX beacon from Lakeview domain controller", "C2 Beaconing", "critical", "open", "2026-10-06 02:05", "Lakeview Medical Centre", B, ["cdn-sync.example"], "MAL-BEACONX",
     "Attackers hold domain admin; encryption is likely within days."),
    ("INC-2520", "Ransom note found on Lakeview file share", "Ransomware", "critical", "open", "2026-10-10 06:20", "Lakeview Medical Centre", B, ["lotus-support.invalid"], "MAL-LOTUSLOCKER",
     "Partial encryption stopped by isolating the file servers."),
    # Banner Drop
    ("INC-2601", "DDoS on National e-Services Portal", "DDoS", "medium", "closed", "2026-08-15 09:00", "National e-Services Portal", W, ["192.0.2.200"], "MAL-WASPNET",
     "Independence Day traffic flood, mitigated by the CDN."),
    ("INC-2603", "Defacement of Smart City notice board", "Defacement", "low", "closed", "2026-08-16 13:00", "Smart City Mission Office", W, ["wasp-nest.test"], None,
     "Banner replaced via the GovCMS XSS flaw."),
    ("INC-2605", "Renewed DDoS during festival traffic", "DDoS", "low", "open", "2026-10-02 18:00", "National e-Services Portal", W, ["192.0.2.201"], "MAL-WASPNET",
     "Low volume; monitoring only."),
    # Unattributed - the triage queue
    ("INC-2701", "Radiology PACS talking to an unknown host", "C2 Beaconing", "high", "open", "2026-10-09 23:40", "Green Valley Medical College", None, ["198.51.100.77"], None,
     "Outbound connections every 5 minutes from the PACS server. Not yet attributed."),
    ("INC-2702", "Unknown host contacting payroll telemetry endpoint", "C2 Beaconing", "medium", "open", "2026-10-07 10:30", "Orion Defence Systems", None, ["192.0.2.45"], None,
     "A machine missed in the July cleanup."),
    ("INC-2703", "KYC-themed phishing e-mail to bank staff", "Phishing", "low", "open", "2026-10-10 09:15", "Konkan Co-operative Bank", None, ["konkan-kyc.test"], None,
     "Staff, not customers, are now being targeted."),
    ("INC-2704", "Port scan from a residential range", "Network Scan", "low", "closed", "2026-09-12 07:00", "Smart City Mission Office", None, [], None,
     "Routine background noise."),
    ("INC-2705", "Brute-force attempts on Sunrise VPN", "Exploit Attempt", "medium", "open", "2026-10-11 04:10", "Sunrise Children's Hospital", None, ["198.51.100.140"], None,
     "Login spray against the still-unpatched EdgeGate portal."),
]

# ---------------------------------------------------------------------------
# Cases (MongoDB only - the analyst's working notes)
# ---------------------------------------------------------------------------
IND_KEY = {v: f"{t}:{v}" for t, v, _ in INDICATORS}
CASES = [
    {"_id": "CASE-2026-034", "title": "Code Blue: hospital ransomware via EdgeGate VPN", "priority": "P1", "status": "open",
     "owner": "Tanishq", "campaignIds": [B], "openedAt": d("2026-09-03 06:00"),
     "summary": "BlackLotus is exploiting CVE-2026-1101 in EdgeGate VPN gateways to deploy LotusLocker in hospitals. CityCare was encrypted in September; Lakeview is mid-intrusion now. Three more hospitals run the same vulnerable VPN.",
     "findings": [
         {"title": "Same exploit chain at both victims", "detail": "CityCare and Lakeview were both entered through EdgeGate and staged tools from 198.51.100.77.", "entityKeys": ["CVE-2026-1101", "ip:198.51.100.77"]},
         {"title": "Three hospitals exposed and not yet hit", "detail": "Sunrise, Green Valley and St. Anne's run EdgeGate; Green Valley is already beaconing to the staging IP.", "entityKeys": ["ORG-GREEN-VALLEY-MEDICAL-COLLEGE", "ORG-ST-ANNE-S-CLINIC", "ORG-SUNRISE-CHILDREN-S-HOSPITAL"]},
         {"title": "Access came from a broker", "detail": "Staging IP and BeaconX domain also belong to CrimsonFox's bank campaign. See CASE-2026-036.", "entityKeys": ["TA-CRIMSONFOX", "domain:cdn-sync.example"]},
     ],
     "recommendations": [
         {"text": "Emergency-patch EdgeGate at Green Valley, Sunrise and St. Anne's", "done": False},
         {"text": "Block 198.51.100.77 and cdn-sync.example across the healthcare ISAC", "done": True},
         {"text": "Isolate Lakeview domain controllers and reset krbtgt twice", "done": False},
         {"text": "Restore CityCare radiology from offline backups", "done": True},
     ]},
    {"_id": "CASE-2026-036", "title": "Access-broker overlap: CrimsonFox to BlackLotus", "priority": "P1", "status": "open",
     "owner": "Anuroop Phukan", "campaignIds": [M, B], "openedAt": d("2026-10-03 11:00"),
     "summary": "Two campaigns that look unrelated (bank phishing and hospital ransomware) share a staging IP, a BeaconX C2 domain and a domain registrant. CrimsonFox appears to sell the access it steals to BlackLotus.",
     "findings": [
         {"title": "Shared staging IP", "detail": "198.51.100.77 is FoxStealer's access-resale panel and LotusDrop's staging server.", "entityKeys": ["ip:198.51.100.77", "MAL-FOXSTEALER", "MAL-LOTUSDROP"]},
         {"title": "Shared post-exploitation tooling", "detail": "BeaconX with the same C2 domain appears at Bank of Deccan and at both hospitals.", "entityKeys": ["MAL-BEACONX", "domain:cdn-sync.example"]},
         {"title": "Same domain registrant", "detail": "reg.admin@mailbox.invalid registered a KYC phishing domain, the BeaconX domain and the ransom portal.", "entityKeys": ["email:reg.admin@mailbox.invalid"]},
     ],
     "recommendations": [
         {"text": "Share the overlap with banking and healthcare CERTs together", "done": False},
         {"text": "Treat any FoxStealer infection inside a corporate network as pre-ransomware", "done": False},
     ]},
    {"_id": "CASE-2026-031", "title": "Monsoon Ledger: KYC fraud against retail banks", "priority": "P1", "status": "open",
     "owner": "Anuroop Phukan", "campaignIds": [M], "openedAt": d("2026-07-11 15:00"),
     "summary": "CrimsonFox sends fake KYC-update SMS and e-mail, harvests net-banking and UPI credentials with KYCKit, and installs FoxStealer to forward OTPs. In September it moved from customers to bank staff.",
     "findings": [
         {"title": "One kit, many lookalike domains", "detail": "Five lure domains on two NL hosting IPs serve the same KYCKit template.", "entityKeys": ["MAL-KYCKIT", "ip:203.0.113.10", "ip:203.0.113.11"]},
         {"title": "Pivot from customers to bank networks", "detail": "FoxStealer found on a Konkan branch PC and BeaconX on a Bank of Deccan jump host.", "entityKeys": ["MAL-FOXSTEALER", "MAL-BEACONX"]},
     ],
     "recommendations": [
         {"text": "Request takedown of 5 lookalike domains", "done": True},
         {"text": "Push in-app warning: banks never ask for KYC over SMS", "done": True},
         {"text": "Hunt for BeaconX across all branch networks", "done": False},
     ]},
    {"_id": "CASE-2026-027", "title": "Silent Courier: LedgerSoft supply-chain compromise", "priority": "P1", "status": "open",
     "owner": "Ishaan Sridharan", "campaignIds": [C], "openedAt": d("2026-07-03 17:00"),
     "summary": "APT-Saffron compromised LedgerSoft's release pipeline and shipped a trojanized payroll update (CourierUpdate) to every customer that auto-updated. Orion Defence lost design documents; Helix University still has an active RAT.",
     "findings": [
         {"title": "One vendor, four victims", "detail": "Every LedgerSoft customer that auto-updated between 30 Jun and 2 Sep was infected.", "entityKeys": ["ORG-LEDGERSOFT", "MAL-COURIERUPDATE"]},
         {"title": "Missed host at Orion", "detail": "A machine is still contacting the DarkLoader telemetry endpoint after cleanup.", "entityKeys": ["ip:192.0.2.45", "ORG-ORION-DEFENCE-SYSTEMS"]},
     ],
     "recommendations": [
         {"text": "Pin LedgerSoft updates to the vendor's real CDN and verify signatures", "done": True},
         {"text": "Re-image the Helix research server", "done": False},
         {"text": "Sweep Orion for hosts beaconing to 192.0.2.45", "done": False},
     ]},
    {"_id": "CASE-2026-022", "title": "Banner Drop: hacktivist DDoS on government portals", "priority": "P3", "status": "monitoring",
     "owner": "Tanishq", "campaignIds": [W], "openedAt": d("2026-08-15 10:00"),
     "summary": "Low-sophistication DDoS and one defacement around national events. No data loss. Kept for context and to rule out links to the other campaigns.",
     "findings": [{"title": "No overlap with other campaigns", "detail": "Residential botnet IPs only; nothing shared with the criminal or espionage infrastructure.", "entityKeys": ["MAL-WASPNET"]}],
     "recommendations": [{"text": "Patch GovCMS XSS (CVE-2026-0615)", "done": True}]},
]


def main():
    mongo = MongoClient(MONGO_URI)
    mongo.drop_database(store.DB_NAME)
    db = mongo[store.DB_NAME]
    store.ensure_collections(db)
    now = datetime.utcnow().replace(microsecond=0)

    def audit(doc, created=None):
        doc["createdAt"] = created or now
        doc["updatedAt"] = created or now
        return doc

    db.threat_actors.insert_many([audit(a, d("2026-06-01")) for a in ACTORS])
    db.campaigns.insert_many([audit(c, c["startedAt"]) for c in CAMPAIGNS])
    db.malware.insert_many([audit({"_id": k, "name": n, "family": n, "malwareType": t, "capabilities": caps, "sha256": sha(n)},
                                  d("2026-06-15")) for k, n, t, caps in MALWARE])
    db.vulnerabilities.insert_many([audit({"_id": k, "name": k, "product": p, "vendor": v, "cvss": cvss, "kev": kev,
                                           "patchAvailable": True, "published": d(pub), "summary": summ}, d(pub))
                                    for k, p, v, cvss, kev, pub, summ in VULNS])
    db.organizations.insert_many([audit({"_id": k, "name": n, "sector": s, "city": city, "size": size, "isVendor": vendor},
                                        d("2026-05-01")) for k, n, s, city, size, vendor in ORGS])

    # first/last seen for indicators come from the incidents that observed them
    seen: dict = {}
    for inc in INCIDENTS:
        for v in inc[8]:
            t = d(inc[5])
            lo, hi = seen.get(v, (t, t))
            seen[v] = (min(lo, t), max(hi, t))
    ind_docs = []
    for t, v, attrs in INDICATORS:
        doc = {"_id": f"{t}:{v}", "type": t, "name": v, **attrs}
        if v in seen:
            doc["firstSeen"], doc["lastSeen"] = seen[v]
        ind_docs.append(audit(doc, attrs.get("registeredAt", d("2026-06-20"))))
    db.indicators.insert_many(ind_docs)

    inc_docs = []
    for k, title, itype, sev, status, at, *_rest in INCIDENTS:
        desc = _rest[-1]
        inc_docs.append(audit({"_id": k, "name": k, "title": title, "incidentType": itype, "severity": sev,
                               "status": status, "detectedAt": d(at), "description": desc}, d(at)))
    db.incidents.insert_many(inc_docs)

    # --- relationships -----------------------------------------------------
    rels = []
    label = {}
    for coll in ("threat_actors", "campaigns", "malware", "vulnerabilities", "organizations", "indicators", "incidents"):
        for doc in db[coll].find({}, {"_id": 1, "type": 1}):
            label[doc["_id"]] = store.label_of(doc, coll)

    def link(rtype, a, b, conf, source, first=None, last=None, notes=None):
        doc = {"_id": store.rel_key(rtype, a, b), "type": rtype, "from": a, "to": b, "fromLabel": label[a],
               "toLabel": label[b], "confidence": conf, "source": source}
        if first:
            doc["firstSeen"] = first
            doc["lastSeen"] = last or first
        if notes:
            doc["notes"] = notes
        assert (label[a], label[b]) in store.RELATIONSHIPS[rtype], (rtype, a, b)
        rels.append(audit(doc, first))

    for a, c in RUNS:
        link("RUNS", a, c, 0.9, "intel-report")
    for c, ms in USES.items():
        for m in ms:
            link("USES", c, m, 0.85 if m != "MAL-BEACONX" else 0.75, "malware-analysis")
    for c, vs in EXPLOITS.items():
        for v in vs:
            link("EXPLOITS", c, v, 0.9, "incident-response")
    for c, orgs in TARGETS.items():
        for o in orgs:
            link("TARGETS", c, O[o], 0.8, "incident-response")
    for m, vals in CONTACTS.items():
        for v in vals:
            link("CONTACTS", m, IND_KEY[v], 0.9 if v != "198.51.100.77" else 0.8, "sandbox")
    for dom, ip in RESOLVES_TO:
        link("RESOLVES_TO", IND_KEY[dom], IND_KEY[ip], 0.95, "passive-dns")
    for dom, em in REGISTERED_BY:
        link("REGISTERED_BY", IND_KEY[dom], IND_KEY[em], 0.7, "whois-history")
    for cve, orgs in EXPOSED_TO.items():
        for o in orgs:
            link("EXPOSED_TO", O[o], cve, 1.0, "asset-scan", d("2026-09-01"))
    for v, c in SUPPLIES:
        link("SUPPLIES", O[v], O[c], 1.0, "vendor-register")
    for k, title, itype, sev, status, at, org, camp, observed, mal, _desc in INCIDENTS:
        t = d(at)
        link("AFFECTED", k, O[org], 1.0, "incident-response", t)
        for v in observed:
            link("OBSERVED", k, IND_KEY[v], 0.9, "edr" if itype != "Phishing" else "mail-gateway", t)
        if mal:
            link("INVOLVED", k, mal, 0.85, "malware-analysis", t)
        if camp:
            link("ATTRIBUTED_TO", k, camp, 0.8, "analyst", t)
    db.relationships.insert_many(rels)

    # --- cases: timeline built from each campaign's incidents ---------------
    by_campaign: dict = {}
    for inc in INCIDENTS:
        if inc[7]:
            by_campaign.setdefault(inc[7], []).append(inc)
    for case in CASES:
        timeline = [{"at": case["openedAt"], "title": "Case opened", "detail": f"Owner: {case['owner']}", "entityKeys": []}]
        for camp in case["campaignIds"]:
            for k, title, itype, sev, status, at, org, *_ in by_campaign.get(camp, []):
                timeline.append({"at": d(at), "title": title, "detail": f"{org} · {sev}", "entityKeys": [k, O[org]],
                                 "severity": sev})
        case["timeline"] = sorted(timeline, key=lambda e: e["at"])
        case["updatedAt"] = case["timeline"][-1]["at"]
        case["createdAt"] = case["openedAt"]
    db.cases.insert_many(CASES)

    activity = []
    for inc in sorted(INCIDENTS, key=lambda i: i[5], reverse=True)[:12]:
        activity.append({"id": str(uuid.uuid4()), "at": d(inc[5]) + timedelta(minutes=20), "action": "create",
                         "kind": "node", "label": "Incident", "entityKey": inc[0],
                         "summary": f"{inc[0]} logged: {inc[1]}", "actor": "SOC"})
    db.activity_log.insert_many(activity)

    driver = GraphDatabase.driver(NEO4J_URI, auth=NEO4J_AUTH)
    n, r = store.rebuild_graph(db, driver)
    driver.close()

    print(f"MongoDB '{store.DB_NAME}':")
    for coll in store.VALIDATORS:
        print(f"  {coll:16s} {db[coll].count_documents({})}")
    print(f"Neo4j projection: {n} nodes, {r} relationships")
    mongo.close()


if __name__ == "__main__":
    main()
