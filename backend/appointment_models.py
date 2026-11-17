from time_utils import utcnow_naive

from sqlalchemy import Column, Integer, String, Date, Time, DateTime, ForeignKey

from database import Base


class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    title = Column(String, nullable=False)
    appointment_type = Column(String, nullable=False)
    appointment_date = Column(Date, nullable=False)
    appointment_time = Column(Time, nullable=True)
    location = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    reminder_sent_at = Column(DateTime, nullable=True)
    status = Column(String, default="scheduled", nullable=False)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)