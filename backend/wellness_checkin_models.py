from time_utils import utcnow_naive

from sqlalchemy import Column, Integer, String, Date, Time, DateTime, ForeignKey

from database import Base


class WellnessCheckIn(Base):
    __tablename__ = "wellness_checkins"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    checkin_date = Column(Date, nullable=False)
    due_time = Column(Time, nullable=False)
    escalation_delay_minutes = Column(Integer, default=60, nullable=False)
    status = Column(String, default="pending", nullable=False)
    checked_in_at = Column(DateTime, nullable=True)
    caregiver_alert_sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
