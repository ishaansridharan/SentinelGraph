from enum import Enum
from typing import List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict

class OutboxStatus(str, Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    PROCESSED = "PROCESSED"
    FAILED = "FAILED"

class SeverityLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class IndicatorSchema(BaseModel):
    type: str
    value: str
    confidence: int = Field(default=80, ge=0, le=100)

class RiskAssessment(BaseModel):
    score: int = Field(default=50, ge=0, le=100)
    severity: SeverityLevel = Field(default=SeverityLevel.MEDIUM)
    reasons: List[str] = Field(default_factory=list)

class IncidentLogSchema(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    event_id: str = Field(alias="eventId")
    event_type: str = Field(alias="eventType")
    observed_at: datetime = Field(default_factory=datetime.utcnow, alias="observedAt")
    classification: str = Field(default="TLP:AMBER")
    region: str = Field(default="IN")
    version: str = Field(default="1.0")
    raw_payload: Dict[str, Any] = Field(alias="rawPayload")
    extracted_indicators: List[IndicatorSchema] = Field(default_factory=list, alias="extractedIndicators")
    risk: RiskAssessment = Field(default_factory=RiskAssessment)

class OutboxEventSchema(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    event_id: str = Field(alias="eventId")
    aggregate_id: str = Field(alias="aggregateId")
    event_type: str = Field(alias="eventType")
    payload: Dict[str, Any]
    status: OutboxStatus = Field(default=OutboxStatus.PENDING)
    attempts: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow, alias="createdAt")

class PageRankRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    damping_factor: float = Field(default=0.85, alias="dampingFactor")
    max_iterations: int = Field(default=20, alias="maxIterations")
    weight_property: str = Field(default="confidence", alias="weightProperty")

class LeidenRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    weight_property: str = Field(default="confidence", alias="weightProperty")
    include_intermediate: bool = Field(default=False, alias="includeIntermediateCommunities")

class AnalyticsRunResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    run_id: str = Field(..., alias="runId")
    algorithm: str
    status: str
    metrics: Dict[str, Any]

