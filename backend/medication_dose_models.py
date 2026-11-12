from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from datetime import datetime

from database import Base


class MedicationDose(Base):
    __tablename__ = "medication_doses"

    id = Column(Integer, primary_key=True, index=True)

    schedule_id = Column(
        Integer,
        ForeignKey("medication_schedules.id"),
        nullable=False
    )

    scheduled_for = Column(DateTime, nullable=False)

    status = Column(
        String,
        default="pending",
        nullable=False
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False
    )

    responded_at = Column(DateTime, nullable=True)

    snoozed_until = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "schedule_id",
            "scheduled_for",
            name="unique_scheduled_dose"
        ),
    )
