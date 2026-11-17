from time_utils import utcnow_naive
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, UniqueConstraint, String
from database import Base


class CaregiverPermission(Base):
    __tablename__ = "caregiver_permissions"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    caregiver_id = Column(Integer, ForeignKey("caregivers.id"), nullable=False)
    can_view_medications = Column(Boolean, default=False, nullable=False)
    can_view_appointments = Column(Boolean, default=False, nullable=False)
    can_view_wellness = Column(Boolean, default=False, nullable=False)
    can_view_emergency = Column(Boolean, default=False, nullable=False)
    can_view_medical_profile = Column(Boolean, default=False, nullable=False)
    can_receive_alerts = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    consented_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    __table_args__ = (
        UniqueConstraint("patient_id", "caregiver_id", name="uq_patient_caregiver_permission"),
    )


class ConsentRecord(Base):
    __tablename__ = "consent_records"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    caregiver_id = Column(Integer, ForeignKey("caregivers.id"), nullable=False)
    action = Column(String(20), nullable=False)
    permission_snapshot = Column(String, nullable=False)
    recorded_at = Column(DateTime, default=utcnow_naive, nullable=False)
    recorded_by_user_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=False)

