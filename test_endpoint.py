from fastapi.testclient import TestClient
from apps.api.main import app

client = TestClient(app)

print("Testing PageRank...")
response = client.post("/api/v1/analytics/pagerank/run", json={
    "dampingFactor": 0.85,
    "maxIterations": 20,
    "weightProperty": "confidence"
})
print(response.status_code)
print(response.text)

print("\nTesting Leiden...")
response = client.post("/api/v1/analytics/communities/run", json={
    "weightProperty": "confidence",
    "relationshipWeightProperty": "confidence",
    "includeIntermediateCommunities": False
})
print(response.status_code)
print(response.text)
