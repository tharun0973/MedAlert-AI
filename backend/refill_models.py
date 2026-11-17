from sqlalchemy import Column, Integer, String, Date, DateTime, ForeignKey
from time_utils import utcnow_naive
from database import Base


class MedicationRefill(Base):
    __tablename__ = "medication_refills"

    id = Column(Integer, primary_key=True, index=True)
    medication_id = Column(Integer, ForeignKey("medications.id"), nullable=False)
    refill_date = Column(Date, nullable=False)
    pharmacy_name = Column(String, nullable=True)
    pharmacy_phone = Column(String, nullable=True)
    status = Column(String, default="pending", nullable=False)
    reminder_sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)