from time_utils import utcnow_naive

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    actor_user_id = Column(
        Integer,
        ForeignKey("user_accounts.id"),
        nullable=True,
    )
    patient_id = Column(
        Integer,
        ForeignKey("patients.id"),
        nullable=True,
    )
    action = Column(String(100), nullable=False)
    resource_type = Column(String(80), nullable=False)
    resource_id = Column(String(80), nullable=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
