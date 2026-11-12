from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from scheduler import start_scheduler

import models
import schemas
import medication_models
import schedule_models
import medication_dose_models


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

@app.get("/medication-doses")
def get_medication_doses(
    status: str = "pending",
    db: Session = Depends(get_db)
):
    doses = db.query(
        medication_dose_models.MedicationDose
    ).filter(
        medication_dose_models.MedicationDose.status == status
    ).all()

    return [
        {
            "dose_id": dose.id,
            "schedule_id": dose.schedule_id,
            "scheduled_for": dose.scheduled_for,
            "status": dose.status
        }
        for dose in doses
    ]

@app.post("/medication-doses/{dose_id}/taken")
def mark_dose_taken(
    dose_id: int,
    db: Session = Depends(get_db)
):
    dose = db.query(
        medication_dose_models.MedicationDose
    ).filter(
        medication_dose_models.MedicationDose.id == dose_id
    ).first()

    if not dose:
        raise HTTPException(
            status_code=404,
            detail="Medication dose not found"
        )

    if dose.status != "pending":
        raise HTTPException(
            status_code=400,
            detail="Dose has already been responded to"
        )

    dose.status = "taken"

    dose.responded_at = datetime.now(
        ZoneInfo("Asia/Kolkata")
    ).replace(tzinfo=None)

    db.commit()
    db.refresh(dose)

    return {
        "message": "Medication marked as taken",
        "dose_id": dose.id,
        "status": dose.status,
        "responded_at": dose.responded_at
    }

@app.post("/medication-doses/{dose_id}/skipped")
def mark_dose_skipped(
    dose_id: int,
    db: Session = Depends(get_db)
):
    dose = db.query(
        medication_dose_models.MedicationDose
    ).filter(
        medication_dose_models.MedicationDose.id == dose_id
    ).first()

    if not dose:
        raise HTTPException(
            status_code=404,
            detail="Medication dose not found"
        )

    if dose.status != "pending":
        raise HTTPException(
            status_code=400,
            detail="Dose has already been responded to"
        )

    dose.status = "skipped"

    dose.responded_at = datetime.now(
        ZoneInfo("Asia/Kolkata")
    ).replace(tzinfo=None)

    db.commit()
    db.refresh(dose)

    return {
        "message": "Medication marked as skipped",
        "dose_id": dose.id,
        "status": dose.status,
        "responded_at": dose.responded_at
    }
@app.post("/medication-doses/{dose_id}/snooze")
def snooze_medication_dose(
    dose_id: int,
    snooze_minutes: int = 10,
    db: Session = Depends(get_db)
):
    if snooze_minutes < 1 or snooze_minutes > 120:
        raise HTTPException(
            status_code=400,
            detail="Snooze duration must be between 1 and 120 minutes"
        )

    dose = db.query(
        medication_dose_models.MedicationDose
    ).filter(
        medication_dose_models.MedicationDose.id == dose_id
    ).first()

    if not dose:
        raise HTTPException(
            status_code=404,
            detail="Medication dose not found"
        )

    if dose.status != "pending":
        raise HTTPException(
            status_code=400,
            detail="Only pending doses can be snoozed"
        )

    snooze_time = datetime.now(
        ZoneInfo("Asia/Kolkata")
    ).replace(tzinfo=None) + timedelta(minutes=snooze_minutes)

    dose.snoozed_until = snooze_time

    db.commit()
    db.refresh(dose)

    return {
        "message": "Medication reminder snoozed successfully",
        "dose_id": dose.id,
        "status": dose.status,
        "snoozed_until": dose.snoozed_until
    }



