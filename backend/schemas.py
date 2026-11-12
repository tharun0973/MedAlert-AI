from datetime import time
from pydantic import BaseModel


class PatientCreate(BaseModel):
    full_name: str
    email: str


class MedicationCreate(BaseModel):
    name: str
    dosage: str
    frequency: str
    reminder_time: time | None = None


class MedicationScheduleCreate(BaseModel):
    reminder_time: time