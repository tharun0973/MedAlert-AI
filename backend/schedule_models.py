from sqlalchemy import Column, Integer, Time, ForeignKey
from database import Base

class MedicationSchedule(Base):
    __tablename__ = "medication_schedules"

    id = Column(Integer, primary_key=True, index=True)
    medication_id = Column(Integer, ForeignKey("medications.id"), nullable=False)
    reminder_time = Column(Time, nullable=False)