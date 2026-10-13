"""
Seed the `sentinel_cti` MongoDB database with the SentinelGraph scenario and
project it into Neo4j.

Four campaigns, modelled on attack patterns seen in India (every name, IP,
domain and CVE here is fictional: IPs come from the RFC 5737 documentation
ranges, domains use reserved .example / .invalid / .test TLDs):

  KYC Update Phishing            TG-1104, a domestic fraud ring, sends "your account
                                 will be blocked, update KYC" SMS, steals net-banking
                                 logins and OTPs, empties accounts through UPI.
  Payroll Software Supply Chain  TG-2207, a state-backed espionage group, breaks into
                                 payroll vendor LekhaSoft and ships a poisoned update
                                 to its government, defence, pharma and university
                                 customers.
  Hospital VPN Ransomware        TG-3310, a ransomware group, gets into hospitals
                                 through an unpatched VPN and encrypts them.
  Independence Day DDoS          TG-4402, hacktivists, flood government portals.
                                 Unrelated background noise.

  The link: the fraud ring sells the bank network access it steals; the
  ransomware group's tools and staging server show up in both campaigns.

  Who's next: five hospitals run the vulnerable VPN; two are encrypted, one
  blocked the attack, Nilgiri Medical College is already talking to the
  attackers' server and St. Anne's has not been touched yet.

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
# Actors - tracked by designation, the way CERTs and vendors name groups
# before attribution is certain
# ---------------------------------------------------------------------------
FRAUD, APT, RANSOM, HACKTIV = "TA-TG-1104", "TA-TG-2207", "TA-TG-3310", "TA-TG-4402"
ACTORS = [
    {"_id": FRAUD, "name": "TG-1104", "aliases": ["KYC fraud ring"], "origin": "India (domestic)",
     "motivation": "financial", "sophistication": "intermediate",
     "description": "Organised fraud ring running fake KYC-update and fake customer-care scams over SMS and WhatsApp. "
                    "Cashes out through rented 'mule' bank accounts, and sells any company network access it picks up along the way."},
    {"_id": APT, "name": "TG-2207", "aliases": ["state-backed espionage group"], "origin": "Foreign, state-backed",
     "motivation": "espionage", "sophistication": "advanced",
     "description": "Espionage group interested in Indian government, port and defence-manufacturing data. "
                    "Prefers to get in through trusted software suppliers rather than attacking targets directly."},
    {"_id": RANSOM, "name": "TG-3310", "aliases": ["ransomware group"], "origin": "Unknown",
     "motivation": "financial", "sophistication": "advanced",
     "description": "Ransomware group that encrypts hospitals and threatens to leak patient data. "
                    "Gets in through unpatched VPN appliances or by buying access from other criminals."},
    {"_id": HACKTIV, "name": "TG-4402", "aliases": ["hacktivist collective"], "origin": "Unknown",
     "motivation": "hacktivism", "sophistication": "basic",
     "description": "Hacktivist collective that floods and defaces government websites around national days for publicity."},
]

KYC, SUPPLY, HOSP, DDOS = "CMP-KYC-UPDATE-PHISHING", "CMP-PAYROLL-SOFTWARE-SUPPLY-CHAIN", "CMP-HOSPITAL-VPN-RANSOMWARE", "CMP-INDEPENDENCE-DAY-DDOS"

# ---------------------------------------------------------------------------
# Organizations (all fictional)
# ---------------------------------------------------------------------------
ORGS = [
    ("ORG-BANK-OF-DECCAN", "Bank of Deccan", "Banking", "Hyderabad", "large", False),
    ("ORG-KONKAN-CO-OPERATIVE-BANK", "Konkan Co-operative Bank", "Banking", "Ratnagiri", "medium", False),
    ("ORG-PAYKARO", "PayKaro UPI", "Fintech", "Bengaluru", "medium", False),
    ("ORG-BHARAT-TELELINK", "Bharat Telelink", "Telecom", "Noida", "large", False),
    ("ORG-LEKHASOFT", "LekhaSoft", "Software Vendor", "Pune", "medium", True),
    ("ORG-DIRECTORATE-OF-PORTS", "Directorate of Ports", "Government", "Visakhapatnam", "large", False),
    ("ORG-BHARAT-AEROSTRUCTURES", "Bharat Aerostructures Ltd", "Defence", "Bengaluru", "large", False),
    ("ORG-SANJEEVANI-PHARMA", "Sanjeevani Pharma", "Pharma", "Ahmedabad", "large", False),
    ("ORG-NARMADA-INSTITUTE-OF-TECHNOLOGY", "Narmada Institute of Technology", "Education", "Vadodara", "large", False),
    ("ORG-KAVERI-MULTISPECIALITY-HOSPITAL", "Kaveri Multispeciality Hospital", "Healthcare", "Chennai", "large", False),
    ("ORG-PERIYAR-MEDICAL-CENTRE", "Periyar Medical Centre", "Healthcare", "Kochi", "medium", False),
    ("ORG-SHISHU-CHILDREN-S-HOSPITAL", "Shishu Children's Hospital", "Healthcare", "Pune", "medium", False),
    ("ORG-NILGIRI-MEDICAL-COLLEGE", "Nilgiri Medical College", "Healthcare", "Coimbatore", "large", False),
    ("ORG-ST-ANNE-S-CLINIC", "St. Anne's Clinic", "Healthcare", "Mangaluru", "small", False),
    ("ORG-STATE-E-SEVA-PORTAL", "State e-Seva Portal", "Government", "Hyderabad", "large", False),
    ("ORG-MUNICIPAL-E-GOVERNANCE-PORTAL", "Municipal e-Governance Portal", "Government", "Nagpur", "small", False),
]
O = {o[1]: o[0] for o in ORGS}

# ---------------------------------------------------------------------------
# Tools and vulnerabilities
# ---------------------------------------------------------------------------
MALWARE = [
    ("MAL-KYC-PHISHING-KIT", "KYC Phishing Kit", "phishing kit", ["fake net-banking login pages", "real-time OTP relay"]),
    ("MAL-OTP-STEALER", "OTP Stealer APK", "Android banking trojan", ["reads and forwards bank SMS", "screen overlays on banking apps"]),
    ("MAL-BEACONX", "BeaconX", "remote-control tool", ["command and control", "moving between machines"]),
    ("MAL-POISONED-UPDATE", "Poisoned Update 4.2.1", "trojanised installer", ["signed-looking software update", "drops a backdoor"]),
    ("MAL-DARKLOADER", "DarkLoader", "backdoor", ["survives reboots", "downloads more tools"]),
    ("MAL-MARBLERAT", "MarbleRAT", "remote access trojan", ["keylogging", "steals files"]),
    ("MAL-EDGEDROP", "EdgeDrop", "loader", ["runs after the VPN exploit", "fetches attack tools"]),
    ("MAL-BLACKCELL", "BlackCell", "ransomware", ["encrypts files", "leaks stolen data"]),
    ("MAL-MIRAI-VARIANT", "Mirai variant", "botnet", ["DDoS from hacked home routers"]),
]
VULNS = [
    ("CVE-2026-1101", "EdgeGate VPN", "EdgeGate", 9.8, True, "2026-08-02", "Anyone on the internet can run commands on the VPN box without logging in."),
    ("CVE-2026-1188", "RemoteDesk Server", "RemoteDesk", 8.8, True, "2026-07-15", "Login bypass that lets an attacker jump from one hospital server to another."),
    ("CVE-2026-0942", "LekhaSoft Payroll Updater", "LekhaSoft", 8.1, True, "2026-07-10", "The updater does not check where an update came from, so a look-alike server can push code."),
    ("CVE-2026-0730", "OfficeDoc Viewer", "OfficeDoc", 7.8, False, "2026-05-28", "Opening a crafted document runs code on the PC."),
    ("CVE-2026-1350", "UPI SDK for Android", "PaySDK", 7.4, False, "2026-06-30", "Lets a malicious app draw a fake screen over a banking app."),
    ("CVE-2026-0615", "e-Gov CMS", "e-Gov CMS", 6.5, False, "2026-04-11", "Lets an attacker change what a public web page shows."),
]
USES = {
    KYC: ["MAL-KYC-PHISHING-KIT", "MAL-OTP-STEALER", "MAL-BEACONX"],
    SUPPLY: ["MAL-POISONED-UPDATE", "MAL-DARKLOADER", "MAL-MARBLERAT"],
    HOSP: ["MAL-EDGEDROP", "MAL-BEACONX", "MAL-BLACKCELL"],
    DDOS: ["MAL-MIRAI-VARIANT"],
}
EXPLOITS = {KYC: ["CVE-2026-1350"], SUPPLY: ["CVE-2026-0942", "CVE-2026-0730"],
            HOSP: ["CVE-2026-1101", "CVE-2026-1188"], DDOS: ["CVE-2026-0615"]}
TARGETS = {
    KYC: ["Bank of Deccan", "Konkan Co-operative Bank", "PayKaro UPI", "Bharat Telelink"],
    SUPPLY: ["LekhaSoft", "Directorate of Ports", "Bharat Aerostructures Ltd", "Sanjeevani Pharma", "Narmada Institute of Technology"],
    HOSP: ["Kaveri Multispeciality Hospital", "Periyar Medical Centre", "Shishu Children's Hospital"],
    DDOS: ["State e-Seva Portal", "Municipal e-Governance Portal"],
}
EXPOSED_TO = {  # from asset scans: who runs the vulnerable product
    "CVE-2026-1101": ["Kaveri Multispeciality Hospital", "Periyar Medical Centre", "Shishu Children's Hospital",
                      "Nilgiri Medical College", "St. Anne's Clinic"],
    "CVE-2026-1188": ["Kaveri Multispeciality Hospital", "Nilgiri Medical College"],
    "CVE-2026-0942": ["Directorate of Ports", "Bharat Aerostructures Ltd", "Sanjeevani Pharma", "Narmada Institute of Technology"],
    "CVE-2026-1350": ["Bank of Deccan", "PayKaro UPI"],
    "CVE-2026-0615": ["Municipal e-Governance Portal"],
}
SUPPLIES = [("LekhaSoft", c) for c in ["Directorate of Ports", "Bharat Aerostructures Ltd", "Sanjeevani Pharma", "Narmada Institute of Technology"]]

# ---------------------------------------------------------------------------
# Indicators
# ---------------------------------------------------------------------------
INDICATORS = [
    ("domain", "kyc-update-deccan.example", {"registrar": "NameSilo", "registeredAt": d("2026-07-01")}),
    ("domain", "deccan-ekyc.invalid", {"registrar": "NameSilo", "registeredAt": d("2026-07-02")}),
    ("domain", "deccan-rewards.example", {"registrar": "Porkbun", "registeredAt": d("2026-08-20")}),
    ("domain", "paykaro-verify.example", {"registrar": "NameSilo", "registeredAt": d("2026-07-25")}),
    ("domain", "konkan-kyc.test", {"registrar": "Porkbun", "registeredAt": d("2026-08-12")}),
    ("ip", "203.0.113.10", {"country": "NL", "asn": "AS64501", "hostingProvider": "budget VPS (NL)"}),
    ("ip", "203.0.113.11", {"country": "NL", "asn": "AS64501", "hostingProvider": "budget VPS (NL)"}),
    ("ip", "198.51.100.23", {"country": "MD", "asn": "AS64505", "hostingProvider": "budget VPS (MD)"}),
    # shared by the fraud ring and the ransomware group
    ("ip", "198.51.100.77", {"country": "SC", "asn": "AS64510", "hostingProvider": "bulletproof hosting"}),
    ("domain", "cdn-sync.example", {"registrar": "Epik", "registeredAt": d("2026-06-15")}),
    ("email", "reg.admin@mailbox.invalid", {}),
    # supply chain
    ("domain", "updates.lekhasoft-cdn.example", {"registrar": "Hostinger", "registeredAt": d("2026-06-10")}),
    ("domain", "telemetry-lekha.invalid", {"registrar": "Hostinger", "registeredAt": d("2026-06-11")}),
    ("ip", "192.0.2.44", {"country": "SG", "asn": "AS64520", "hostingProvider": "cloud VPS (SG)"}),
    ("ip", "192.0.2.45", {"country": "SG", "asn": "AS64520", "hostingProvider": "cloud VPS (SG)"}),
    ("ip", "203.0.113.90", {"country": "HK", "asn": "AS64522", "hostingProvider": "cloud VPS (HK)"}),
    ("email", "it.desk@protonmail.invalid", {}),
    # hospital ransomware
    ("ip", "198.51.100.140", {"country": "RU", "asn": "AS64530", "hostingProvider": "scanning network"}),
    ("ip", "198.51.100.141", {"country": "RU", "asn": "AS64530", "hostingProvider": "scanning network"}),
    ("ip", "198.51.100.150", {"country": "SC", "asn": "AS64510", "hostingProvider": "bulletproof hosting"}),
    ("domain", "blackcell-support.invalid", {"registrar": "Epik", "registeredAt": d("2026-08-22")}),
    # DDoS
    ("ip", "192.0.2.200", {"country": "VN", "asn": "AS64540", "hostingProvider": "hacked home routers"}),
    ("ip", "192.0.2.201", {"country": "BR", "asn": "AS64541", "hostingProvider": "hacked home routers"}),
    ("domain", "botnet-c2.test", {"registrar": "Namecheap", "registeredAt": d("2026-08-01")}),
]
CONTACTS = {
    "MAL-KYC-PHISHING-KIT": ["kyc-update-deccan.example", "deccan-ekyc.invalid", "deccan-rewards.example", "paykaro-verify.example", "konkan-kyc.test"],
    "MAL-OTP-STEALER": ["198.51.100.23", "198.51.100.77"],
    "MAL-BEACONX": ["cdn-sync.example"],
    "MAL-POISONED-UPDATE": ["updates.lekhasoft-cdn.example"],
    "MAL-DARKLOADER": ["telemetry-lekha.invalid"],
    "MAL-MARBLERAT": ["203.0.113.90"],
    "MAL-EDGEDROP": ["198.51.100.141", "198.51.100.77"],
    "MAL-BLACKCELL": ["blackcell-support.invalid"],
    "MAL-MIRAI-VARIANT": ["192.0.2.200", "192.0.2.201", "botnet-c2.test"],
}
RESOLVES_TO = [
    ("kyc-update-deccan.example", "203.0.113.10"), ("deccan-ekyc.invalid", "203.0.113.10"),
    ("deccan-rewards.example", "203.0.113.10"), ("paykaro-verify.example", "203.0.113.11"),
    ("konkan-kyc.test", "203.0.113.11"), ("cdn-sync.example", "198.51.100.77"),
    ("updates.lekhasoft-cdn.example", "192.0.2.44"), ("telemetry-lekha.invalid", "192.0.2.45"),
    ("blackcell-support.invalid", "198.51.100.150"), ("botnet-c2.test", "192.0.2.200"),
]
REGISTERED_BY = [
    ("deccan-ekyc.invalid", "reg.admin@mailbox.invalid"), ("cdn-sync.example", "reg.admin@mailbox.invalid"),
    ("blackcell-support.invalid", "reg.admin@mailbox.invalid"),
    ("updates.lekhasoft-cdn.example", "it.desk@protonmail.invalid"), ("telemetry-lekha.invalid", "it.desk@protonmail.invalid"),
]

# ---------------------------------------------------------------------------
# Incidents: id, title, type, severity, status, detected, org, campaign, observed, malware, description
# ---------------------------------------------------------------------------
INCIDENTS = [
    # KYC Update Phishing
    ("INC-2401", "Customers report 'KYC update or account blocked' SMS", "Phishing", "medium", "closed", "2026-07-09 10:20", "Bank of Deccan", KYC, ["kyc-update-deccan.example"], "MAL-KYC-PHISHING-KIT",
     "Over 300 customers forwarded an SMS saying their account would be blocked today unless they updated KYC on a link."),
    ("INC-2402", "Fake net-banking login page for Bank of Deccan", "Phishing", "high", "contained", "2026-07-11 14:05", "Bank of Deccan", KYC, ["kyc-update-deccan.example", "203.0.113.10"], "MAL-KYC-PHISHING-KIT",
     "Exact copy of the bank's login page asking for user ID, password and OTP. Takedown requested."),
    ("INC-2405", "Logins with stolen passwords at night", "Credential Theft", "high", "closed", "2026-07-19 02:40", "Bank of Deccan", KYC, ["198.51.100.23"], "MAL-OTP-STEALER",
     "Burst of successful logins between 2 and 4 a.m. from one foreign server."),
    ("INC-2409", "Telecom reseller account used to send lure SMS", "Phishing", "medium", "closed", "2026-07-24 09:00", "Bharat Telelink", KYC, ["paykaro-verify.example"], "MAL-KYC-PHISHING-KIT",
     "A hijacked bulk-SMS reseller account sent 40,000 fake KYC messages under a bank-like sender ID."),
    ("INC-2411", "PayKaro users sent to fake 'verify UPI' page", "Phishing", "high", "contained", "2026-08-02 18:30", "PayKaro UPI", KYC, ["paykaro-verify.example", "203.0.113.11"], "MAL-KYC-PHISHING-KIT",
     "Users asked to re-enter their UPI PIN to 'avoid suspension'."),
    ("INC-2414", "Rs 38 lakh moved out through UPI to mule accounts", "Fraud", "critical", "investigating", "2026-08-09 23:10", "PayKaro UPI", KYC, ["198.51.100.23"], "MAL-OTP-STEALER",
     "Victims had installed a 'KYC app'. It forwarded every OTP, and money left within minutes. Complaints filed on the 1930 helpline."),
    ("INC-2418", "Same scam now aimed at Konkan Bank customers", "Phishing", "medium", "contained", "2026-08-18 11:45", "Konkan Co-operative Bank", KYC, ["konkan-kyc.test"], "MAL-KYC-PHISHING-KIT",
     "Same message template and phishing kit, new domain, smaller co-operative bank."),
    ("INC-2421", "Fake 'Deccan KYC' Android app installed by customers", "Malware", "high", "investigating", "2026-08-27 16:00", "Bank of Deccan", KYC, ["deccan-ekyc.invalid"], "MAL-OTP-STEALER",
     "APK shared over WhatsApp; draws a fake screen over the real banking app."),
    ("INC-2427", "Stealer found on a bank branch computer", "C2 Beaconing", "high", "investigating", "2026-09-06 08:15", "Konkan Co-operative Bank", KYC, ["198.51.100.77"], "MAL-OTP-STEALER",
     "First infection inside the bank's own network rather than on a customer's phone."),
    ("INC-2433", "Bank staff VPN logins offered for sale online", "Data Leak", "critical", "open", "2026-09-18 12:00", "Bank of Deccan", KYC, ["198.51.100.77"], "MAL-OTP-STEALER",
     "Forum post selling 'VPN + admin access to an Indian bank'. The seller's panel is on 198.51.100.77."),
    ("INC-2440", "Remote-control tool on Bank of Deccan's admin server", "C2 Beaconing", "critical", "open", "2026-09-29 03:20", "Bank of Deccan", KYC, ["cdn-sync.example"], "MAL-BEACONX",
     "Someone is now using the access that was sold: BeaconX is running on the server admins use to reach everything else."),
    ("INC-2446", "New 'festive reward points' lure before Diwali", "Phishing", "medium", "open", "2026-10-08 19:00", "PayKaro UPI", KYC, ["deccan-rewards.example"], "MAL-KYC-PHISHING-KIT",
     "Same kit and server, new theme: 'redeem your reward points before they expire'."),
    # Payroll Software Supply Chain
    ("INC-2301", "LekhaSoft build server accessed from unknown IP", "Intrusion", "high", "closed", "2026-06-22 01:30", "LekhaSoft", SUPPLY, ["192.0.2.44"], "MAL-POISONED-UPDATE",
     "Attacker changed the update address in LekhaSoft's release process to a look-alike domain."),
    ("INC-2304", "Payroll update 4.2.1 downloaded from look-alike site", "Supply Chain", "high", "contained", "2026-06-30 10:00", "Directorate of Ports", SUPPLY, ["updates.lekhasoft-cdn.example"], "MAL-POISONED-UPDATE",
     "Automatic update pulled the package from lekhasoft-cdn.example instead of LekhaSoft's real server."),
    ("INC-2306", "Hidden backdoor calling out from accounts-section PC", "C2 Beaconing", "high", "contained", "2026-07-03 15:40", "Directorate of Ports", SUPPLY, ["telemetry-lekha.invalid", "192.0.2.45"], "MAL-DARKLOADER",
     "Hourly connection disguised as payroll usage statistics."),
    ("INC-2310", "Same poisoned payroll update at Bharat Aerostructures", "Supply Chain", "high", "contained", "2026-07-08 09:10", "Bharat Aerostructures Ltd", SUPPLY, ["updates.lekhasoft-cdn.example"], "MAL-POISONED-UPDATE",
     "Identical file hash to the Directorate of Ports install."),
    ("INC-2312", "Aircraft component design files stolen", "Data Exfiltration", "critical", "investigating", "2026-07-21 22:50", "Bharat Aerostructures Ltd", SUPPLY, ["203.0.113.90"], "MAL-MARBLERAT",
     "1.2 GB of design drawings sent out over two nights."),
    ("INC-2316", "Fake 'revised DA circular' document sent to HR", "Phishing", "medium", "closed", "2026-07-29 11:00", "Bharat Aerostructures Ltd", SUPPLY, [], "MAL-MARBLERAT",
     "Booby-trapped document used to get back in after the first clean-up."),
    ("INC-2319", "Poisoned update found on HR servers", "Supply Chain", "medium", "contained", "2026-08-05 13:30", "Sanjeevani Pharma", SUPPLY, ["updates.lekhasoft-cdn.example"], "MAL-POISONED-UPDATE",
     "Found while checking machines after LekhaSoft's advisory."),
    ("INC-2322", "Backdoor survived the update rollback", "Malware", "high", "investigating", "2026-08-20 17:20", "Sanjeevani Pharma", SUPPLY, ["telemetry-lekha.invalid"], "MAL-DARKLOADER",
     "A scheduled task kept the backdoor alive after the bad update was removed."),
    ("INC-2325", "Backdoor traffic from the institute's admin office", "C2 Beaconing", "medium", "contained", "2026-09-02 10:05", "Narmada Institute of Technology", SUPPLY, ["192.0.2.45"], "MAL-DARKLOADER",
     "The institute installed the update late, so it was hit late."),
    ("INC-2329", "Remote access trojan on a research server", "Malware", "high", "open", "2026-09-25 21:15", "Narmada Institute of Technology", SUPPLY, ["203.0.113.90"], "MAL-MARBLERAT",
     "The server belongs to a defence-funded research lab."),
    # Hospital VPN Ransomware
    ("INC-2501", "Internet-wide scanning for EdgeGate VPN boxes", "Network Scan", "low", "closed", "2026-08-26 04:00", "Shishu Children's Hospital", HOSP, ["198.51.100.140"], None,
     "Scanning started within days of the EdgeGate advisory."),
    ("INC-2503", "VPN attack blocked by firewall rule", "Exploit Attempt", "medium", "closed", "2026-08-28 04:30", "Shishu Children's Hospital", HOSP, ["198.51.100.141"], "MAL-EDGEDROP",
     "A temporary firewall rule stopped the exploit. The VPN itself is still not patched."),
    ("INC-2505", "VPN broken into; attack tools downloaded", "Intrusion", "high", "contained", "2026-09-03 02:10", "Kaveri Multispeciality Hospital", HOSP, ["198.51.100.141", "198.51.100.77"], "MAL-EDGEDROP",
     "The exploit worked. EdgeDrop then pulled tools from 198.51.100.77."),
    ("INC-2507", "Attackers move from VPN to radiology and billing servers", "Lateral Movement", "high", "contained", "2026-09-05 01:00", "Kaveri Multispeciality Hospital", HOSP, ["cdn-sync.example"], "MAL-BEACONX",
     "Used the RemoteDesk login bypass to hop between servers."),
    ("INC-2509", "Radiology and billing systems encrypted", "Ransomware", "critical", "contained", "2026-09-07 05:45", "Kaveri Multispeciality Hospital", HOSP, ["blackcell-support.invalid"], "MAL-BLACKCELL",
     "OPD registration went back to paper; emergency cases diverted to other hospitals for 14 hours."),
    ("INC-2512", "Patient records posted on leak site", "Data Leak", "critical", "investigating", "2026-09-15 12:00", "Kaveri Multispeciality Hospital", HOSP, ["blackcell-support.invalid"], "MAL-BLACKCELL",
     "8,000 patient records published to pressure the hospital into paying."),
    ("INC-2516", "Same VPN attack succeeds at Periyar Medical Centre", "Intrusion", "high", "investigating", "2026-10-02 03:30", "Periyar Medical Centre", HOSP, ["198.51.100.140", "198.51.100.77"], "MAL-EDGEDROP",
     "Same exploit and same tool server as Kaveri, four weeks later."),
    ("INC-2518", "Attackers control Periyar's main admin server", "C2 Beaconing", "critical", "open", "2026-10-06 02:05", "Periyar Medical Centre", HOSP, ["cdn-sync.example"], "MAL-BEACONX",
     "They now have admin rights over every PC; encryption usually follows within days."),
    ("INC-2520", "Ransom note found on Periyar's file server", "Ransomware", "critical", "open", "2026-10-10 06:20", "Periyar Medical Centre", HOSP, ["blackcell-support.invalid"], "MAL-BLACKCELL",
     "Encryption stopped part-way by unplugging the file servers."),
    # Independence Day DDoS
    ("INC-2601", "State e-Seva Portal flooded on 15 August", "DDoS", "medium", "closed", "2026-08-15 09:00", "State e-Seva Portal", DDOS, ["192.0.2.200"], "MAL-MIRAI-VARIANT",
     "Certificate and bill-payment services slow for three hours; absorbed by the CDN."),
    ("INC-2603", "Municipal notice board page defaced", "Defacement", "low", "closed", "2026-08-16 13:00", "Municipal e-Governance Portal", DDOS, ["botnet-c2.test"], None,
     "Banner replaced through a flaw in the e-Gov CMS."),
    ("INC-2605", "Smaller flood during festival traffic", "DDoS", "low", "open", "2026-10-02 18:00", "State e-Seva Portal", DDOS, ["192.0.2.201"], "MAL-MIRAI-VARIANT",
     "Low volume; being watched."),
    # Not yet attributed - the triage queue
    ("INC-2701", "Medical college X-ray server talking to unknown host", "C2 Beaconing", "high", "open", "2026-10-09 23:40", "Nilgiri Medical College", None, ["198.51.100.77"], None,
     "The X-ray image server connects out every 5 minutes. Nobody has linked it to a campaign yet."),
    ("INC-2702", "Missed machine still calling the payroll backdoor server", "C2 Beaconing", "medium", "open", "2026-10-07 10:30", "Bharat Aerostructures Ltd", None, ["192.0.2.45"], None,
     "A PC that was skipped during the July clean-up."),
    ("INC-2703", "KYC-themed phishing e-mail sent to bank staff", "Phishing", "low", "open", "2026-10-10 09:15", "Konkan Co-operative Bank", None, ["konkan-kyc.test"], None,
     "Staff, not customers, are now receiving the lure."),
    ("INC-2704", "Port scan from a home internet connection", "Network Scan", "low", "closed", "2026-09-12 07:00", "Municipal e-Governance Portal", None, [], None,
     "Routine background noise."),
    ("INC-2705", "Password-guessing on Shishu Hospital's VPN", "Exploit Attempt", "medium", "open", "2026-10-11 04:10", "Shishu Children's Hospital", None, ["198.51.100.140"], None,
     "The still-unpatched VPN is being tried again from the same scanning network."),
]

# ---------------------------------------------------------------------------
# Campaigns, with the attack told step by step
# ---------------------------------------------------------------------------
I = lambda v: f"ip:{v}"  # noqa: E731
D = lambda v: f"domain:{v}"  # noqa: E731
CAMPAIGNS = [
    {"_id": KYC, "name": "KYC Update Phishing", "status": "active", "startedAt": d("2026-07-08"),
     "objective": "Empty bank and UPI accounts using fake 'update your KYC' messages", "sectors": ["Banking", "Fintech"], "regions": ["IN"],
     "summary": "TG-1104 sends SMS and WhatsApp messages saying the customer's bank account will be blocked unless they update KYC. "
                "The link opens a fake bank login page. Victims are also asked to install a 'KYC app', which forwards their OTPs. "
                "Money is moved out through UPI to mule accounts within minutes.",
     "realWorld": "The RBI and banks regularly warn customers about exactly this: KYC/PAN-update SMS, fake customer-care numbers and APKs shared on WhatsApp. "
                  "Victims are told to report on cybercrime.gov.in or call the 1930 helpline.",
     "story": [
         {"stage": "Preparation", "title": "Look-alike websites are set up",
          "text": "The ring registers domains that look like the banks' (kyc-update-deccan.example, paykaro-verify.example …) and hosts a ready-made phishing kit on two cheap servers.",
          "entityKeys": ["MAL-KYC-PHISHING-KIT", D("kyc-update-deccan.example"), D("paykaro-verify.example"), I("203.0.113.10"), I("203.0.113.11")]},
         {"stage": "Delivery", "title": "Bulk SMS through a hijacked telecom account",
          "text": "\"Dear customer, your account will be blocked today. Update KYC: <link>\" goes to tens of thousands of numbers from a hijacked bulk-SMS reseller account at Bharat Telelink.",
          "entityKeys": ["ORG-BHARAT-TELELINK", "INC-2409", "INC-2401"]},
         {"stage": "Credential theft", "title": "Victims type their login and OTP into the fake page",
          "text": "The fake page asks for user ID, password and OTP, and passes them to the attacker instantly so they can log in before the OTP expires.",
          "entityKeys": ["INC-2402", "INC-2411", "ORG-BANK-OF-DECCAN", "ORG-PAYKARO"]},
         {"stage": "Cash-out", "title": "A fake 'KYC app' forwards every OTP; money leaves through UPI",
          "text": "Victims are asked to install an APK. It reads bank SMS and sends OTPs to 198.51.100.23. Rs 38 lakh moved to mule accounts in one night.",
          "entityKeys": ["MAL-OTP-STEALER", I("198.51.100.23"), "INC-2414", "INC-2421", "CVE-2026-1350"]},
         {"stage": "Escalation", "title": "The ring gets inside a bank and sells the access",
          "text": "A branch PC is infected. Staff VPN logins are put up for sale on a panel hosted at 198.51.100.77.",
          "entityKeys": ["INC-2427", "INC-2433", I("198.51.100.77"), "ORG-KONKAN-CO-OPERATIVE-BANK"]},
         {"stage": "Hand-off", "title": "A buyer uses the access",
          "text": "BeaconX, a remote-control tool, appears on Bank of Deccan's admin server, talking to cdn-sync.example. The same tool and server are later used against hospitals.",
          "entityKeys": ["MAL-BEACONX", D("cdn-sync.example"), "INC-2440"]},
     ]},
    {"_id": SUPPLY, "name": "Payroll Software Supply Chain", "status": "active", "startedAt": d("2026-06-20"),
     "objective": "Spy on government and defence organisations through software they already trust",
     "sectors": ["Government", "Defence", "Pharma", "Education"], "regions": ["IN"],
     "summary": "TG-2207 broke into LekhaSoft, a payroll software company, and changed where its software downloads updates from. "
                "Every customer that auto-updated installed a backdoor. At a defence manufacturer the attackers stole design files.",
     "realWorld": "Same pattern as SolarWinds (2020) and 3CX (2023): attack one software supplier and you reach all of its customers, "
                  "because they trust and auto-install its updates.",
     "story": [
         {"stage": "Initial access", "title": "The software vendor is breached",
          "text": "Attackers get into LekhaSoft's build server and point the payroll software's update address at a look-alike domain they control.",
          "entityKeys": ["ORG-LEKHASOFT", "INC-2301", I("192.0.2.44"), "CVE-2026-0942"]},
         {"stage": "Delivery", "title": "Customers install a poisoned update",
          "text": "Payroll update 4.2.1 is downloaded from updates.lekhasoft-cdn.example by every customer with auto-update on.",
          "entityKeys": ["MAL-POISONED-UPDATE", D("updates.lekhasoft-cdn.example"), "INC-2304", "INC-2310", "INC-2319"]},
         {"stage": "Persistence", "title": "A hidden backdoor checks in every hour",
          "text": "DarkLoader installs quietly and connects to telemetry-lekha.invalid, pretending to be payroll usage statistics.",
          "entityKeys": ["MAL-DARKLOADER", D("telemetry-lekha.invalid"), I("192.0.2.45"), "INC-2306", "INC-2322"]},
         {"stage": "Theft", "title": "Design files leave the defence manufacturer",
          "text": "At Bharat Aerostructures, MarbleRAT copies aircraft component drawings out to 203.0.113.90. A fake DA-circular document is used to get back in after clean-up.",
          "entityKeys": ["MAL-MARBLERAT", I("203.0.113.90"), "INC-2312", "INC-2316", "CVE-2026-0730", "ORG-BHARAT-AEROSTRUCTURES"]},
         {"stage": "Still active", "title": "Not fully cleaned up",
          "text": "A research server at Narmada Institute still has the trojan, and one forgotten PC at Bharat Aerostructures still calls the backdoor server.",
          "entityKeys": ["INC-2329", "INC-2702", "ORG-NARMADA-INSTITUTE-OF-TECHNOLOGY"]},
     ]},
    {"_id": HOSP, "name": "Hospital VPN Ransomware", "status": "active", "startedAt": d("2026-08-25"),
     "objective": "Lock hospital systems and demand ransom, threatening to leak patient data", "sectors": ["Healthcare"], "regions": ["IN"],
     "summary": "TG-3310 breaks into hospitals through a flaw in EdgeGate VPN boxes that many hospitals have not patched, "
                "moves to key servers, encrypts them and leaks patient records. Kaveri is recovering, Periyar is under attack now, "
                "and three more hospitals run the same VPN.",
     "realWorld": "Like the AIIMS Delhi ransomware attack (November 2022), which forced the hospital onto manual registers for days. "
                  "Unpatched VPNs and firewalls are one of the most common ways in.",
     "story": [
         {"stage": "Reconnaissance", "title": "Scanning for vulnerable VPN boxes",
          "text": "Days after the EdgeGate flaw is published, the group scans the internet for hospitals that have not patched.",
          "entityKeys": ["CVE-2026-1101", I("198.51.100.140"), "INC-2501"]},
         {"stage": "Initial access", "title": "In through the VPN",
          "text": "At Kaveri the exploit works. EdgeDrop downloads attack tools from 198.51.100.77, the same server the KYC fraud ring uses.",
          "entityKeys": ["MAL-EDGEDROP", I("198.51.100.141"), I("198.51.100.77"), "INC-2505", "ORG-KAVERI-MULTISPECIALITY-HOSPITAL"]},
         {"stage": "Lateral movement", "title": "From the VPN to radiology and billing",
          "text": "BeaconX and a login bypass in RemoteDesk let them hop to the servers that matter most.",
          "entityKeys": ["MAL-BEACONX", D("cdn-sync.example"), "CVE-2026-1188", "INC-2507"]},
         {"stage": "Impact", "title": "Systems encrypted",
          "text": "BlackCell encrypts radiology and billing. Registration goes back to paper and emergency cases are diverted.",
          "entityKeys": ["MAL-BLACKCELL", "INC-2509"]},
         {"stage": "Extortion", "title": "Patient records leaked to force payment",
          "text": "8,000 patient records are posted on the group's leak and negotiation site.",
          "entityKeys": [D("blackcell-support.invalid"), "INC-2512"]},
         {"stage": "Next targets", "title": "The same attack is spreading",
          "text": "Periyar Medical Centre is mid-attack. Shishu, Nilgiri and St. Anne's run the same unpatched VPN, and Nilgiri is already talking to 198.51.100.77.",
          "entityKeys": ["ORG-PERIYAR-MEDICAL-CENTRE", "INC-2518", "INC-2520", "ORG-SHISHU-CHILDREN-S-HOSPITAL", "ORG-NILGIRI-MEDICAL-COLLEGE", "ORG-ST-ANNE-S-CLINIC"]},
     ]},
    {"_id": DDOS, "name": "Independence Day DDoS", "status": "dormant", "startedAt": d("2026-08-10"),
     "objective": "Take government websites offline around national days for publicity", "sectors": ["Government"], "regions": ["IN"],
     "summary": "TG-4402 used thousands of hacked home routers to flood a state e-services portal on 15 August and defaced a municipal page. "
                "No data was stolen. It is kept here because analysts must rule it in or out when looking at the other campaigns.",
     "realWorld": "Hacktivist DDoS waves against Indian government sites around Independence Day and Republic Day are reported almost every year.",
     "story": [
         {"stage": "Delivery", "title": "Hacked home routers flood the portal",
          "text": "A Mirai-style botnet sends junk traffic to the State e-Seva Portal on 15 August.",
          "entityKeys": ["MAL-MIRAI-VARIANT", I("192.0.2.200"), "INC-2601", "ORG-STATE-E-SEVA-PORTAL"]},
         {"stage": "Impact", "title": "A public page is defaced",
          "text": "A flaw in the e-Gov CMS lets them replace a municipal notice banner.",
          "entityKeys": ["CVE-2026-0615", "INC-2603", "ORG-MUNICIPAL-E-GOVERNANCE-PORTAL"]},
         {"stage": "Assessment", "title": "Unrelated to the other campaigns",
          "text": "Nothing here is shared with the fraud, espionage or ransomware infrastructure.",
          "entityKeys": ["TA-TG-4402"]},
     ]},
]
RUNS = [(FRAUD, KYC), (APT, SUPPLY), (RANSOM, HOSP), (HACKTIV, DDOS)]

# ---------------------------------------------------------------------------
# Cases (MongoDB only - the analyst's working file)
# ---------------------------------------------------------------------------
CASES = [
    {"_id": "CASE-2026-034", "title": "Ransomware attacks on hospitals through EdgeGate VPN", "priority": "P1", "status": "open",
     "owner": "Tanishq", "campaignIds": [HOSP], "openedAt": d("2026-09-03 06:00"),
     "summary": "TG-3310 is getting into hospitals through an unpatched EdgeGate VPN flaw and encrypting them. Kaveri was hit in September; "
                "Periyar is being attacked now. Three more hospitals run the same VPN.",
     "findings": [
         {"title": "Same method at both hospitals", "detail": "Kaveri and Periyar were both entered through EdgeGate and downloaded tools from 198.51.100.77.", "entityKeys": ["CVE-2026-1101", I("198.51.100.77")]},
         {"title": "Three hospitals exposed, not yet encrypted", "detail": "Shishu, Nilgiri and St. Anne's run EdgeGate. Nilgiri's X-ray server is already talking to the attackers' server.", "entityKeys": ["ORG-NILGIRI-MEDICAL-COLLEGE", "ORG-ST-ANNE-S-CLINIC", "ORG-SHISHU-CHILDREN-S-HOSPITAL"]},
         {"title": "The access may have been bought", "detail": "The tool server and BeaconX domain also belong to the KYC fraud ring. See CASE-2026-036.", "entityKeys": [FRAUD, D("cdn-sync.example")]},
     ],
     "recommendations": [
         {"text": "Patch EdgeGate at Nilgiri, Shishu and St. Anne's today", "done": False},
         {"text": "Block 198.51.100.77 and cdn-sync.example for all hospitals via CERT-In advisory", "done": True},
         {"text": "Disconnect Periyar's admin servers and reset all admin passwords", "done": False},
         {"text": "Restore Kaveri radiology from offline backups", "done": True},
     ]},
    {"_id": "CASE-2026-036", "title": "Fraud ring selling bank access to ransomware group", "priority": "P1", "status": "open",
     "owner": "Anuroop Phukan", "campaignIds": [KYC, HOSP], "openedAt": d("2026-10-03 11:00"),
     "summary": "Two campaigns that look unrelated, bank KYC fraud and hospital ransomware, share a server, a remote-control tool and the e-mail used to register their domains. "
                "The fraud ring (TG-1104) appears to sell the access it steals to the ransomware group (TG-3310).",
     "findings": [
         {"title": "Shared server", "detail": "198.51.100.77 hosts the fraud ring's access-for-sale panel and the ransomware group's tool downloads.", "entityKeys": [I("198.51.100.77"), "MAL-OTP-STEALER", "MAL-EDGEDROP"]},
         {"title": "Shared tool", "detail": "BeaconX talking to cdn-sync.example was found at Bank of Deccan and at both hospitals.", "entityKeys": ["MAL-BEACONX", D("cdn-sync.example")]},
         {"title": "Same person registered the domains", "detail": "reg.admin@mailbox.invalid registered a fake KYC domain, the BeaconX domain and the ransomware leak site.", "entityKeys": ["email:reg.admin@mailbox.invalid"]},
     ],
     "recommendations": [
         {"text": "Share the link with banking and health-sector CERTs together", "done": False},
         {"text": "Treat any stealer found inside a bank network as a ransomware warning", "done": False},
     ]},
    {"_id": "CASE-2026-031", "title": "Fake KYC-update SMS fraud against bank customers", "priority": "P1", "status": "open",
     "owner": "Anuroop Phukan", "campaignIds": [KYC], "openedAt": d("2026-07-11 15:00"),
     "summary": "TG-1104 sends 'update KYC or your account will be blocked' SMS, steals logins and OTPs on fake pages and through a fake app, "
                "and moves money out through UPI. In September it moved from targeting customers to targeting bank staff.",
     "findings": [
         {"title": "One phishing kit, many look-alike sites", "detail": "Five fake domains on two servers serve the same kit.", "entityKeys": ["MAL-KYC-PHISHING-KIT", I("203.0.113.10"), I("203.0.113.11")]},
         {"title": "From customers' phones to the banks' own network", "detail": "The OTP stealer was found on a Konkan branch PC and a remote-control tool on Bank of Deccan's admin server.", "entityKeys": ["MAL-OTP-STEALER", "MAL-BEACONX"]},
     ],
     "recommendations": [
         {"text": "Get the 5 look-alike domains taken down", "done": True},
         {"text": "In-app banner: the bank never asks for KYC over SMS or WhatsApp", "done": True},
         {"text": "Check every branch PC for BeaconX", "done": False},
     ]},
    {"_id": "CASE-2026-027", "title": "LekhaSoft payroll update compromise", "priority": "P1", "status": "open",
     "owner": "Ishaan Sridharan", "campaignIds": [SUPPLY], "openedAt": d("2026-07-03 17:00"),
     "summary": "TG-2207 broke into payroll vendor LekhaSoft and shipped a poisoned update to every customer that auto-updated. "
                "Bharat Aerostructures lost design files; Narmada Institute still has an active trojan.",
     "findings": [
         {"title": "One vendor, four victims", "detail": "Every LekhaSoft customer that auto-updated between 30 June and 2 September was infected.", "entityKeys": ["ORG-LEKHASOFT", "MAL-POISONED-UPDATE"]},
         {"title": "A machine was missed", "detail": "One PC at Bharat Aerostructures is still contacting the backdoor server.", "entityKeys": [I("192.0.2.45"), "ORG-BHARAT-AEROSTRUCTURES"]},
     ],
     "recommendations": [
         {"text": "Only accept LekhaSoft updates from its real server, and check the signature", "done": True},
         {"text": "Wipe and rebuild the Narmada research server", "done": False},
         {"text": "Search Bharat Aerostructures for anything contacting 192.0.2.45", "done": False},
     ]},
    {"_id": "CASE-2026-022", "title": "Independence Day DDoS on government portals", "priority": "P3", "status": "monitoring",
     "owner": "Tanishq", "campaignIds": [DDOS], "openedAt": d("2026-08-15 10:00"),
     "summary": "Hacktivist traffic flood and one page defacement around 15 August. No data lost. Kept open to rule out links to the other campaigns.",
     "findings": [{"title": "No overlap with other campaigns", "detail": "Only hacked home routers; nothing shared with the criminal or espionage infrastructure.", "entityKeys": ["MAL-MIRAI-VARIANT"]}],
     "recommendations": [{"text": "Patch the e-Gov CMS flaw (CVE-2026-0615)", "done": True}]},
]


def main():
    mongo = MongoClient(MONGO_URI)
    mongo.drop_database(store.DB_NAME)
    db = mongo[store.DB_NAME]
    store.ensure_collections(db)

    def audit(doc, created):
        doc["createdAt"] = created
        doc["updatedAt"] = created
        return doc

    ind_key = {v: f"{t}:{v}" for t, v, _ in INDICATORS}

    db.threat_actors.insert_many([audit(a, d("2026-06-01")) for a in ACTORS])
    db.campaigns.insert_many([audit(c, c["startedAt"]) for c in CAMPAIGNS])
    db.malware.insert_many([audit({"_id": k, "name": n, "family": n, "malwareType": t, "capabilities": caps, "sha256": sha(n)},
                                  d("2026-06-15")) for k, n, t, caps in MALWARE])
    db.vulnerabilities.insert_many([audit({"_id": k, "name": k, "product": p, "vendor": v, "cvss": cvss, "kev": kev,
                                           "patchAvailable": True, "published": d(pub), "summary": summ}, d(pub))
                                    for k, p, v, cvss, kev, pub, summ in VULNS])
    db.organizations.insert_many([audit({"_id": k, "name": n, "sector": s, "city": city, "size": size, "isVendor": vendor},
                                        d("2026-05-01")) for k, n, s, city, size, vendor in ORGS])

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

    db.incidents.insert_many([
        audit({"_id": k, "name": k, "title": title, "incidentType": itype, "severity": sev, "status": status,
               "detectedAt": d(at), "description": desc}, d(at))
        for k, title, itype, sev, status, at, _org, _camp, _obs, _mal, desc in INCIDENTS])

    # --- relationships ------------------------------------------------------
    label = {}
    for coll in ("threat_actors", "campaigns", "malware", "vulnerabilities", "organizations", "indicators", "incidents"):
        for doc in db[coll].find({}, {"_id": 1, "type": 1}):
            label[doc["_id"]] = store.label_of(doc, coll)
    for k in [k for c in CAMPAIGNS for st in c["story"] for k in st["entityKeys"]] + \
             [k for c in CASES for f in c["findings"] for k in f["entityKeys"]]:
        assert k in label, f"story/finding points at unknown entity {k}"
    rels = []

    def link(rtype, a, b, conf, source, first=None):
        assert (label[a], label[b]) in store.RELATIONSHIPS[rtype], (rtype, a, b)
        doc = {"_id": store.rel_key(rtype, a, b), "type": rtype, "from": a, "to": b, "fromLabel": label[a],
               "toLabel": label[b], "confidence": conf, "source": source}
        if first:
            doc["firstSeen"] = doc["lastSeen"] = first
        rels.append(audit(doc, first or d("2026-06-20")))

    for a, c in RUNS:
        link("RUNS", a, c, 0.9, "intel report")
    for c, ms in USES.items():
        for m in ms:
            link("USES", c, m, 0.75 if m == "MAL-BEACONX" else 0.85, "malware analysis")
    for c, vs in EXPLOITS.items():
        for v in vs:
            link("EXPLOITS", c, v, 0.9, "incident response")
    for c, orgs in TARGETS.items():
        for o in orgs:
            link("TARGETS", c, O[o], 0.8, "incident response")
    for m, vals in CONTACTS.items():
        for v in vals:
            link("CONTACTS", m, ind_key[v], 0.8 if v == "198.51.100.77" else 0.9, "sandbox")
    for dom, ip in RESOLVES_TO:
        link("RESOLVES_TO", ind_key[dom], ind_key[ip], 0.95, "passive DNS")
    for dom, em in REGISTERED_BY:
        link("REGISTERED_BY", ind_key[dom], ind_key[em], 0.7, "WHOIS history")
    for cve, orgs in EXPOSED_TO.items():
        for o in orgs:
            link("EXPOSED_TO", O[o], cve, 1.0, "asset scan", d("2026-09-01"))
    for v, c in SUPPLIES:
        link("SUPPLIES", O[v], O[c], 1.0, "vendor register")
    for k, title, itype, sev, status, at, org, camp, observed, mal, _desc in INCIDENTS:
        t = d(at)
        link("AFFECTED", k, O[org], 1.0, "incident response", t)
        for v in observed:
            link("OBSERVED", k, ind_key[v], 0.9, "mail gateway" if itype == "Phishing" else "EDR", t)
        if mal:
            link("INVOLVED", k, mal, 0.85, "malware analysis", t)
        if camp:
            link("ATTRIBUTED_TO", k, camp, 0.8, "analyst", t)
    db.relationships.insert_many(rels)

    # --- cases: timeline built from each campaign's incidents ----------------
    by_campaign: dict = {}
    for inc in INCIDENTS:
        if inc[7]:
            by_campaign.setdefault(inc[7], []).append(inc)
    for case in CASES:
        timeline = [{"at": case["openedAt"], "title": "Case opened", "detail": f"Owner: {case['owner']}", "entityKeys": []}]
        for camp in case["campaignIds"]:
            for k, title, itype, sev, status, at, org, *_ in by_campaign.get(camp, []):
                timeline.append({"at": d(at), "title": title, "detail": f"{org} · {sev}", "entityKeys": [k, O[org]], "severity": sev})
        case["timeline"] = sorted(timeline, key=lambda e: e["at"])
        case["updatedAt"] = case["timeline"][-1]["at"]
        case["createdAt"] = case["openedAt"]
    db.cases.insert_many(CASES)

    db.activity_log.insert_many([
        {"id": str(uuid.uuid4()), "at": d(inc[5]) + timedelta(minutes=20), "action": "create", "kind": "node",
         "label": "Incident", "entityKey": inc[0], "summary": f"{inc[0]} logged: {inc[1]}", "actor": "SOC"}
        for inc in sorted(INCIDENTS, key=lambda i: i[5], reverse=True)[:12]])

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
