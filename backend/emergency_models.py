from time_utils import utcnow_naive
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey
from database import Base

class EmergencyContact(Base):
    __tablename__ = "emergency_contacts"
    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    full_name = Column(String, nullable=False)
    relationship = Column(String, nullable=True)
    phone = Column(String, nullable=False)
    email = Column(String, nullable=True)
    is_primary = Column(Boolean, default=False, nullable=False)
    receives_emergency_alerts = Column(Boolean, default=True, nullable=False)

class MedicalProfile(Base):
    __tablename__ = "medical_profiles"
    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), unique=True, nullable=False)
    blood_group = Column(String, nullable=True)
    allergies = Column(Text, nullable=True)
    medical_conditions = Column(Text, nullable=True)
    physician_name = Column(String, nullable=True)
    physician_phone = Column(String, nullable=True)
    physician_address = Column(Text, nullable=True)
    insurance_provider = Column(String, nullable=True)
    insurance_policy_number = Column(String, nullable=True)
    insurance_member_id = Column(String, nullable=True)
    updated_at = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive)

class EmergencyAlert(Base):
    __tablename__ = "emergency_alerts"
    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    emergency_contact_id = Column(Integer, ForeignKey("emergency_contacts.id"), nullable=False)
    message = Column(String, nullable=False)
    status = Column(String, default="pending", nullable=False)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
