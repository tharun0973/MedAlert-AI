from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy import Time
from database import Base

class Medication(Base):
    __tablename__ = "medications"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    dosage = Column(String, nullable=False)
    frequency = Column(String, nullable=False)
    patient_id = Column(Integer, ForeignKey("patients.id"))

    reminder_time = Column(Time, nullable=True)