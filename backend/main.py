from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from scheduler import start_scheduler

import models
import schemas
import medication_models
import schedule_models


from database import engine, Base, SessionLocal

Base.metadata.create_all(bind=engine)

app = FastAPI()
@app.on_event("startup")
def startup_event():
    start_scheduler()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.get("/")
def home():
    return {"message": "Welcome to MedAlert AI"}


@app.post("/patients")
def register_patient(
    patient: schemas.PatientCreate,
    db: Session = Depends(get_db)
):
    existing_patient = db.query(models.Patient).filter(
        models.Patient.email == patient.email
    ).first()

    if existing_patient:
        raise HTTPException(
            status_code=400,
            detail="Email already registered"
        )

    new_patient = models.Patient(
        full_name=patient.full_name,
        email=patient.email
    )

    db.add(new_patient)
    db.commit()
    db.refresh(new_patient)

    return {
        "message": "Patient registered successfully",
        "patient_id": new_patient.id,
        "full_name": new_patient.full_name,
        "email": new_patient.email
    }
@app.get("/patients")
def get_patients(db: Session = Depends(get_db)):
    patients = db.query(models.Patient).all()

    return patients
@app.get("/patients/{patient_id}")
def get_patient(patient_id: int, db: Session = Depends(get_db)):
    patient = db.query(models.Patient).filter(
        models.Patient.id == patient_id
    ).first()

    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    return patient
@app.post("/patients/{patient_id}/medications")
def add_medication(
    patient_id: int,
    medication: schemas.MedicationCreate,
    db: Session = Depends(get_db)
):
    patient = db.query(models.Patient).filter(
        models.Patient.id == patient_id
    ).first()

    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    new_medication = medication_models.Medication(
    name=medication.name,
    dosage=medication.dosage,
    frequency=medication.frequency,
    reminder_time=medication.reminder_time,
    patient_id=patient_id
)

    db.add(new_medication)
    db.commit()
    db.refresh(new_medication)

    return {
        "message": "Medication added successfully",
        "medication_id": new_medication.id,
        "name": new_medication.name,
        "dosage": new_medication.dosage,
        "frequency": new_medication.frequency,
        "reminder_time": str(new_medication.reminder_time) if new_medication.reminder_time else None,
        "patient_id": new_medication.patient_id
    }
@app.get("/patients/{patient_id}/medications")
def get_medications(
    patient_id: int,
    db: Session = Depends(get_db)
):
    patient = db.query(models.Patient).filter(
        models.Patient.id == patient_id
    ).first()

    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    medications = db.query(medication_models.Medication).filter(
        medication_models.Medication.patient_id == patient_id
    ).all()

    return medications
@app.post("/medications/{medication_id}/schedules")
def add_medication_schedule(
    medication_id: int,
    schedule: schemas.MedicationScheduleCreate,
    db: Session = Depends(get_db)
):
    medication = db.query(medication_models.Medication).filter(
        medication_models.Medication.id == medication_id
    ).first()

    if not medication:
        raise HTTPException(status_code=404, detail="Medication not found")

    new_schedule = schedule_models.MedicationSchedule(
        medication_id=medication_id,
        reminder_time=schedule.reminder_time
    )

    db.add(new_schedule)
    db.commit()
    db.refresh(new_schedule)

    return {
        "message": "Reminder time added successfully",
        "schedule_id": new_schedule.id,
        "medication_id": medication_id,
        "reminder_time": str(new_schedule.reminder_time)
    }
@app.get("/medications/{medication_id}/schedules")
def get_medication_schedules(
    medication_id: int,
    db: Session = Depends(get_db)
):
    medication = db.query(medication_models.Medication).filter(
        medication_models.Medication.id == medication_id
    ).first()

    if not medication:
        raise HTTPException(status_code=404, detail="Medication not found")

    schedules = db.query(schedule_models.MedicationSchedule).filter(
        schedule_models.MedicationSchedule.medication_id == medication_id
    ).all()

    return [
        {
            "schedule_id": schedule.id,
            "medication_id": schedule.medication_id,
            "reminder_time": str(schedule.reminder_time)
        }
        for schedule in schedules
    ]