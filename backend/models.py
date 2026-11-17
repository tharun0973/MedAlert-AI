from time_utils import utcnow_naive
from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, UniqueConstraint
from database import Base

class Patient(Base):
    __tablename__ = "patients"
    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)

class Caregiver(Base):
    __tablename__ = "caregivers"
    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    phone = Column(String, nullable=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    relationship = Column(String, nullable=True)

class CaregiverAlert(Base):
    __tablename__ = "caregiver_alerts"
    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    caregiver_id = Column(Integer, ForeignKey("caregivers.id"), nullable=False)
    dose_id = Column(Integer, ForeignKey("medication_doses.id"), nullable=True)
    message = Column(String, nullable=False)
    status = Column(String, default="pending", nullable=False)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
    acknowledged_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("dose_id", "caregiver_id", name="unique_dose_caregiver_alert"),
    )