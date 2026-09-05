from fastapi.testclient import TestClient
from apps.api.main import app

client = TestClient(app)
try:
    response = client.post("/api/v1/analytics/pagerank/run", json={
        "dampingFactor": 0.85,
        "maxIterations": 20,
        "weightProperty": "confidence"
    })
    print(response.status_code)
    print(response.text)
except Exception as e:
    import traceback
    traceback.print_exc()
