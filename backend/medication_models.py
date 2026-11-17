from sqlalchemy import Column, Integer, String, ForeignKey, Time, Boolean
from database import Base


class Medication(Base):
    __tablename__ = "medications"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    dosage = Column(String, nullable=False)
    frequency = Column(String, nullable=False)
    patient_id = Column(Integer, ForeignKey("patients.id"))
    reminder_time = Column(Time, nullable=True)

    is_critical = Column(Boolean, default=False, nullable=False)
    grace_period_minutes = Column(Integer, default=30, nullable=False)
    food_instructions = Column(String, nullable=True)
    photo_path = Column(String, nullable=True)