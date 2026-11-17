from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
import shutil
import uuid

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

import appointment_models
import audit_models
import auth_models
import auth_routes
import emergency_models
import medication_dose_models
import medication_models
import models
import permission_models
import refill_models
import schedule_models
import schemas
import wellness_checkin_models
from database import Base, SessionLocal, engine
from time_utils import utcnow_naive

Base.metadata.create_all(bind=engine)

@asynccontextmanager
async def lifespan(app: FastAPI):
    from scheduler import scheduler, start_scheduler

    start_scheduler()
    try:
        yield
    finally:
        if scheduler.running:
            scheduler.shutdown(wait=False)


app = FastAPI(
    title="MedAlert AI API",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(auth_routes.router)

IST = ZoneInfo("Asia/Kolkata")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def audit(db: Session, user, patient_id, action, resource_type, resource_id=None, details=None):
    db.add(audit_models.AuditLog(
        actor_user_id=user.id if user else None,
        patient_id=patient_id,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id is not None else None,
        details=details,
    ))


def require_patient_access(db: Session, user, patient_id: int, permission: str | None = None):
    if user.role == "senior":
        if user.patient_id != patient_id:
            raise HTTPException(status_code=403, detail="Access denied")
        return
    if user.role != "caregiver" or not user.caregiver_id:
        raise HTTPException(status_code=403, detail="Access denied")
    caregiver = db.query(models.Caregiver).filter(models.Caregiver.id == user.caregiver_id).first()
    if not caregiver or caregiver.patient_id != patient_id:
        raise HTTPException(status_code=403, detail="Access denied")
    grant = db.query(permission_models.CaregiverPermission).filter(
        permission_models.CaregiverPermission.patient_id == patient_id,
        permission_models.CaregiverPermission.caregiver_id == caregiver.id,
        permission_models.CaregiverPermission.is_active.is_(True),
    ).first()
    if not grant or (permission and not getattr(grant, permission, False)):
        raise HTTPException(status_code=403, detail="Caregiver permission not granted")


def require_senior(user):
    if user.role != "senior" or not user.patient_id:
        raise HTTPException(status_code=403, detail="Only the patient account can perform this action")


def patient_or_404(db, patient_id):
    patient = db.query(models.Patient).filter(models.Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return patient


def medication_or_404(db, medication_id):
    item = db.query(medication_models.Medication).filter(medication_models.Medication.id == medication_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Medication not found")
    return item


def dose_and_patient_or_404(db, dose_id):
    dose = db.query(medication_dose_models.MedicationDose).filter(
        medication_dose_models.MedicationDose.id == dose_id
    ).first()
    if not dose:
        raise HTTPException(status_code=404, detail="Medication dose not found")
    schedule = db.query(schedule_models.MedicationSchedule).filter(
        schedule_models.MedicationSchedule.id == dose.schedule_id
    ).first()
    medication = medication_or_404(db, schedule.medication_id) if schedule else None
    if not medication:
        raise HTTPException(status_code=404, detail="Medication schedule not found")
    return dose, medication


@app.get("/")
def home():
    return {"message": "Welcome to MedAlert AI"}


# Patient profile creation is the first onboarding step; account registration follows via /auth/register.
@app.post("/patients")
def register_patient(patient: schemas.PatientCreate, db: Session = Depends(get_db)):
    email = str(patient.email).strip().lower()
    existing = db.query(models.Patient).filter(models.Patient.email == email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    new_patient = models.Patient(full_name=patient.full_name.strip(), email=email)
    db.add(new_patient)
    db.commit()
    db.refresh(new_patient)
    return {"message": "Patient registered successfully", "patient_id": new_patient.id,
            "full_name": new_patient.full_name, "email": new_patient.email}


@app.get("/patients")
def get_patients(db: Session = Depends(get_db), user=Depends(auth_routes.get_current_user)):
    if user.role == "senior":
        query = db.query(models.Patient).filter(models.Patient.id == user.patient_id)
    elif user.role == "caregiver" and user.caregiver_id:
        caregiver = db.query(models.Caregiver).filter(models.Caregiver.id == user.caregiver_id).first()
        query = db.query(models.Patient).filter(models.Patient.id == caregiver.patient_id) if caregiver else db.query(models.Patient).filter(False)
    else:
        raise HTTPException(status_code=403, detail="Access denied")
    return query.all()


@app.get("/patients/{patient_id}")
def get_patient(patient_id: int, db: Session = Depends(get_db), user=Depends(auth_routes.get_current_user)):
    patient_or_404(db, patient_id)
    require_patient_access(db, user, patient_id)
    audit(db, user, patient_id, "view_patient", "patient", patient_id)
    db.commit()
    return db.query(models.Patient).filter(models.Patient.id == patient_id).first()


@app.post("/patients/{patient_id}/medications")
def add_medication(patient_id: int, medication: schemas.MedicationCreate,
                   db: Session = Depends(get_db), user=Depends(auth_routes.get_current_user)):
    patient_or_404(db, patient_id); require_patient_access(db, user, patient_id); require_senior(user)
    item = medication_models.Medication(**medication.model_dump(), patient_id=patient_id)
    db.add(item); db.flush()
    audit(db, user, patient_id, "create_medication", "medication", item.id)
    db.commit(); db.refresh(item)
    return {"message": "Medication added successfully", "medication_id": item.id, **medication.model_dump(), "patient_id": patient_id}


@app.get("/patients/{patient_id}/medications")
def get_medications(
    patient_id: int,
    db: Session = Depends(get_db),
    user=Depends(auth_routes.get_current_user)
):
    patient_or_404(db, patient_id)
    require_patient_access(db, user, patient_id, "can_view_medications")

    items = (
        db.query(medication_models.Medication)
        .filter(medication_models.Medication.patient_id == patient_id)
        .all()
    )

    audit(db, user, patient_id, "view_medications", "medication")
    db.commit()

    return [
        {
            "id": item.id,
            "name": item.name,
            "dosage": item.dosage,
            "frequency": item.frequency,
            "reminder_time": item.reminder_time,
            "is_critical": item.is_critical,
            "grace_period_minutes": item.grace_period_minutes,
            "food_instructions": item.food_instructions,
            "patient_id": item.patient_id
        }
        for item in items
    ]


@app.post("/medications/{medication_id}/photo")
def upload_medication_photo(medication_id: int, file: UploadFile = File(...),
                            db: Session = Depends(get_db), user=Depends(auth_routes.get_current_user)):
    item = medication_or_404(db, medication_id); require_patient_access(db, user, item.patient_id); require_senior(user)
    types = {"image/jpeg": ".jpg", "image/png": ".png"}
    if file.content_type not in types:
        raise HTTPException(status_code=400, detail="Only JPG and PNG images are allowed")
    upload_dir = Path("uploads/medications"); upload_dir.mkdir(parents=True, exist_ok=True)
    path = upload_dir / f"{uuid.uuid4().hex}{types[file.content_type]}"
    try:
        file.file.seek(0, 2); size = file.file.tell(); file.file.seek(0)
        if size == 0 or size > 5 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Image must be non-empty and 5 MB or smaller")
        with path.open("wb") as target:
            shutil.copyfileobj(file.file, target)
        item.photo_path = str(path)
        audit(db, user, item.patient_id, "upload_medication_photo", "medication", item.id)
        db.commit()
    except Exception:
        db.rollback()
        if path.exists(): path.unlink()
        raise
    finally:
        file.file.close()
    return {"message": "Medication photo uploaded successfully", "medication_id": item.id, "photo_path": item.photo_path}


@app.post("/medications/{medication_id}/schedules")
def add_medication_schedule(medication_id: int, schedule: schemas.MedicationScheduleCreate,
                            db: Session = Depends(get_db), user=Depends(auth_routes.get_current_user)):
    med = medication_or_404(db, medication_id); require_patient_access(db, user, med.patient_id); require_senior(user)
    item = schedule_models.MedicationSchedule(medication_id=medication_id, reminder_time=schedule.reminder_time)
    db.add(item); db.flush(); audit(db, user, med.patient_id, "create_schedule", "medication_schedule", item.id)
    db.commit(); db.refresh(item)
    return {"message": "Reminder time added successfully", "schedule_id": item.id,
            "medication_id": medication_id, "reminder_time": str(item.reminder_time)}


@app.get("/medications/{medication_id}/schedules")
def get_medication_schedules(medication_id: int, db: Session = Depends(get_db), user=Depends(auth_routes.get_current_user)):
    med = medication_or_404(db, medication_id); require_patient_access(db, user, med.patient_id, "can_view_medications")
    rows = db.query(schedule_models.MedicationSchedule).filter(schedule_models.MedicationSchedule.medication_id == medication_id).all()
    audit(db, user, med.patient_id, "view_schedules", "medication_schedule", medication_id); db.commit()
    return [{"schedule_id": x.id, "medication_id": x.medication_id, "reminder_time": str(x.reminder_time)} for x in rows]


@app.get("/medication-doses")
def get_medication_doses(status: str = "pending", db: Session = Depends(get_db),
                         user=Depends(auth_routes.get_current_user)):
    if user.role == "senior":
        patient_id = user.patient_id
    elif user.role == "caregiver" and user.caregiver_id:
        caregiver = db.query(models.Caregiver).filter(models.Caregiver.id == user.caregiver_id).first()
        patient_id = caregiver.patient_id if caregiver else None
        require_patient_access(db, user, patient_id, "can_view_medications")
    else:
        raise HTTPException(status_code=403, detail="Access denied")
    rows = db.query(medication_dose_models.MedicationDose).join(
        schedule_models.MedicationSchedule,
        medication_dose_models.MedicationDose.schedule_id == schedule_models.MedicationSchedule.id
    ).join(medication_models.Medication,
           schedule_models.MedicationSchedule.medication_id == medication_models.Medication.id
    ).filter(medication_models.Medication.patient_id == patient_id,
             medication_dose_models.MedicationDose.status == status).all()
    audit(db, user, patient_id, "view_doses", "medication_dose"); db.commit()
    return [{"dose_id": x.id, "schedule_id": x.schedule_id, "scheduled_for": x.scheduled_for, "status": x.status} for x in rows]


def update_dose(dose_id, new_status, db, user):
    dose, med = dose_and_patient_or_404(db, dose_id)
    require_patient_access(db, user, med.patient_id); require_senior(user)
    if dose.status != "pending":
        raise HTTPException(status_code=400, detail="Dose has already been responded to")
    dose.status = new_status
    dose.responded_at = datetime.now(IST).replace(tzinfo=None)
    audit(db, user, med.patient_id, f"dose_{new_status}", "medication_dose", dose.id)
    db.commit(); db.refresh(dose)
    return {"message": f"Medication marked as {new_status}", "dose_id": dose.id,
            "status": dose.status, "responded_at": dose.responded_at}


@app.post("/medication-doses/{dose_id}/taken")
def mark_dose_taken(dose_id: int, db: Session = Depends(get_db), user=Depends(auth_routes.get_current_user)):
    return update_dose(dose_id, "taken", db, user)


@app.post("/medication-doses/{dose_id}/skipped")
def mark_dose_skipped(dose_id: int, db: Session = Depends(get_db), user=Depends(auth_routes.get_current_user)):
    return update_dose(dose_id, "skipped", db, user)


@app.post("/medication-doses/{dose_id}/delayed")
def mark_dose_delayed(dose_id: int, db: Session = Depends(get_db), user=Depends(auth_routes.get_current_user)):
    return update_dose(dose_id, "delayed", db, user)


@app.post("/medication-doses/{dose_id}/snooze")
def snooze_medication_dose(dose_id: int, snooze_minutes: int = 10, db: Session = Depends(get_db),
                           user=Depends(auth_routes.get_current_user)):
    if not 1 <= snooze_minutes <= 120:
        raise HTTPException(status_code=400, detail="Snooze duration must be between 1 and 120 minutes")
    dose, med = dose_and_patient_or_404(db, dose_id)
    require_patient_access(db, user, med.patient_id); require_senior(user)
    if dose.status != "pending":
        raise HTTPException(status_code=400, detail="Only pending doses can be snoozed")
    dose.snoozed_until = datetime.now(IST).replace(tzinfo=None) + timedelta(minutes=snooze_minutes)
    audit(db, user, med.patient_id, "snooze_dose", "medication_dose", dose.id)
    db.commit(); db.refresh(dose)
    return {"message": "Medication reminder snoozed successfully", "dose_id": dose.id,
            "status": dose.status, "snoozed_until": dose.snoozed_until}


@app.post("/caregivers")
def create_caregiver(caregiver: schemas.CaregiverCreate, db: Session = Depends(get_db),
                     user=Depends(auth_routes.get_current_user)):
    require_patient_access(db, user, caregiver.patient_id); require_senior(user)
    patient_or_404(db, caregiver.patient_id)
    email = str(caregiver.email).strip().lower()
    if db.query(models.Caregiver).filter(models.Caregiver.email == email).first():
        raise HTTPException(status_code=400, detail="Caregiver email already registered")
    item = models.Caregiver(full_name=caregiver.full_name, email=email, phone=caregiver.phone,
                            patient_id=caregiver.patient_id, relationship=caregiver.relationship)
    db.add(item); db.flush()
    audit(db, user, caregiver.patient_id, "create_caregiver_profile", "caregiver", item.id)
    db.commit(); db.refresh(item)
    return {"message": "Caregiver profile created. The caregiver can now register an account.",
            "caregiver_id": item.id, "full_name": item.full_name, "email": item.email, "patient_id": item.patient_id}


@app.get("/patients/{patient_id}/caregivers")
def get_patient_caregivers(patient_id: int, db: Session = Depends(get_db),
                           user=Depends(auth_routes.get_current_user)):
    patient_or_404(db, patient_id); require_patient_access(db, user, patient_id)
    return db.query(models.Caregiver).filter(models.Caregiver.patient_id == patient_id).all()


@app.put("/patients/{patient_id}/caregivers/{caregiver_id}/permissions")
def set_caregiver_permissions(patient_id: int, caregiver_id: int, data: schemas.CaregiverPermissionUpdate,
                              db: Session = Depends(get_db), user=Depends(auth_routes.get_current_user)):
    require_patient_access(db, user, patient_id); require_senior(user)
    caregiver = db.query(models.Caregiver).filter(models.Caregiver.id == caregiver_id,
                                                   models.Caregiver.patient_id == patient_id).first()
    if not caregiver:
        raise HTTPException(status_code=404, detail="Caregiver not found for this patient")
    grant = db.query(permission_models.CaregiverPermission).filter_by(patient_id=patient_id,
                                                                       caregiver_id=caregiver_id).first()
    if not grant:
        grant = permission_models.CaregiverPermission(patient_id=patient_id, caregiver_id=caregiver_id)
        db.add(grant)
    for key, value in data.model_dump().items():
        setattr(grant, key, value)
    grant.is_active = True; grant.consented_at = utcnow_naive(); grant.revoked_at = None
    db.flush()
    db.add(permission_models.ConsentRecord(patient_id=patient_id, caregiver_id=caregiver_id,
        action="granted", permission_snapshot=str(data.model_dump()), recorded_by_user_id=user.id))
    audit(db, user, patient_id, "grant_caregiver_permissions", "caregiver", caregiver_id)
    db.commit()
    return {"message": "Caregiver permissions granted", "patient_id": patient_id, "caregiver_id": caregiver_id,
            "permissions": data.model_dump()}


@app.delete("/patients/{patient_id}/caregivers/{caregiver_id}/permissions")
def revoke_caregiver_permissions(patient_id: int, caregiver_id: int, db: Session = Depends(get_db),
                                 user=Depends(auth_routes.get_current_user)):
    require_patient_access(db, user, patient_id); require_senior(user)
    grant = db.query(permission_models.CaregiverPermission).filter_by(
        patient_id=patient_id, caregiver_id=caregiver_id, is_active=True).first()
    if not grant:
        raise HTTPException(status_code=404, detail="Active caregiver permission not found")
    grant.is_active = False; grant.revoked_at = utcnow_naive()
    snapshot = {k: getattr(grant, k) for k in (
        "can_view_medications", "can_view_appointments", "can_view_wellness",
        "can_view_emergency", "can_view_medical_profile", "can_receive_alerts")}
    db.add(permission_models.ConsentRecord(patient_id=patient_id, caregiver_id=caregiver_id,
        action="revoked", permission_snapshot=str(snapshot), recorded_by_user_id=user.id))
    audit(db, user, patient_id, "revoke_caregiver_permissions", "caregiver", caregiver_id)
    db.commit()
    return {"message": "Caregiver access revoked", "patient_id": patient_id, "caregiver_id": caregiver_id}


@app.get("/caregiver-alerts")
def get_caregiver_alerts(db: Session = Depends(get_db), user=Depends(auth_routes.get_current_user)):
    if user.role != "caregiver" or not user.caregiver_id:
        raise HTTPException(status_code=403, detail="Caregiver account required")
    caregiver = db.query(models.Caregiver).filter(models.Caregiver.id == user.caregiver_id).first()
    if not caregiver:
        raise HTTPException(status_code=404, detail="Caregiver profile not found")
    require_patient_access(db, user, caregiver.patient_id, "can_receive_alerts")
    return db.query(models.CaregiverAlert).filter(
        models.CaregiverAlert.caregiver_id == caregiver.id).order_by(models.CaregiverAlert.created_at.desc()).all()


@app.post("/caregiver-alerts/{alert_id}/acknowledge")
def acknowledge_caregiver_alert(alert_id: int, db: Session = Depends(get_db),
                                user=Depends(auth_routes.get_current_user)):
    if user.role != "caregiver" or not user.caregiver_id:
        raise HTTPException(status_code=403, detail="Caregiver account required")
    alert = db.query(models.CaregiverAlert).filter(
        models.CaregiverAlert.id == alert_id, models.CaregiverAlert.caregiver_id == user.caregiver_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Caregiver alert not found")
    require_patient_access(db, user, alert.patient_id, "can_receive_alerts")
    if alert.status == "acknowledged":
        raise HTTPException(status_code=400, detail="Alert already acknowledged")
    alert.status = "acknowledged"; alert.acknowledged_at = datetime.now(IST).replace(tzinfo=None)
    audit(db, user, alert.patient_id, "acknowledge_alert", "caregiver_alert", alert.id)
    db.commit(); db.refresh(alert)
    return {"message": "Caregiver alert acknowledged successfully", "alert_id": alert.id,
            "status": alert.status, "acknowledged_at": alert.acknowledged_at}


@app.post("/medications/{medication_id}/refills")
def create_medication_refill(medication_id: int, refill: schemas.MedicationRefillCreate,
                             db: Session = Depends(get_db), user=Depends(auth_routes.get_current_user)):
    med = medication_or_404(db, medication_id); require_patient_access(db, user, med.patient_id); require_senior(user)
    item = refill_models.MedicationRefill(medication_id=medication_id, **refill.model_dump())
    db.add(item); db.flush(); audit(db, user, med.patient_id, "create_refill", "medication_refill", item.id)
    db.commit(); db.refresh(item)
    return {"message": "Medication refill created successfully", "refill_id": item.id,
            "medication_id": item.medication_id, "refill_date": item.refill_date,
            "pharmacy_name": item.pharmacy_name, "pharmacy_phone": item.pharmacy_phone, "status": item.status}


@app.get("/medications/{medication_id}/refills")
def get_medication_refills(medication_id: int, db: Session = Depends(get_db),
                           user=Depends(auth_routes.get_current_user)):
    med = medication_or_404(db, medication_id); require_patient_access(db, user, med.patient_id, "can_view_medications")
    rows = db.query(refill_models.MedicationRefill).filter(
        refill_models.MedicationRefill.medication_id == medication_id).all()
    audit(db, user, med.patient_id, "view_refills", "medication_refill", medication_id); db.commit()
    return rows


@app.post("/appointments")
def create_appointment(appointment: schemas.AppointmentCreate, db: Session = Depends(get_db),
                       user=Depends(auth_routes.get_current_user)):
    patient_or_404(db, appointment.patient_id); require_patient_access(db, user, appointment.patient_id); require_senior(user)
    if appointment.appointment_type not in {"appointment", "lab_test"}:
        raise HTTPException(status_code=400, detail="appointment_type must be 'appointment' or 'lab_test'")
    item = appointment_models.Appointment(**appointment.model_dump())
    db.add(item); db.flush(); audit(db, user, item.patient_id, "create_appointment", "appointment", item.id)
    db.commit(); db.refresh(item)
    return {"message": "Appointment or lab test created successfully", "appointment_id": item.id,
            "patient_id": item.patient_id, "title": item.title, "appointment_type": item.appointment_type,
            "appointment_date": item.appointment_date, "appointment_time": str(item.appointment_time) if item.appointment_time else None,
            "location": item.location, "notes": item.notes, "status": item.status}


@app.get("/patients/{patient_id}/appointments")
def get_patient_appointments(patient_id: int, db: Session = Depends(get_db),
                              user=Depends(auth_routes.get_current_user)):
    patient_or_404(db, patient_id); require_patient_access(db, user, patient_id, "can_view_appointments")
    rows = db.query(appointment_models.Appointment).filter(
        appointment_models.Appointment.patient_id == patient_id).order_by(
        appointment_models.Appointment.appointment_date, appointment_models.Appointment.appointment_time).all()
    audit(db, user, patient_id, "view_appointments", "appointment"); db.commit()
    return rows


@app.post("/wellness-checkins")
def create_wellness_checkin(checkin: schemas.WellnessCheckInCreate, db: Session = Depends(get_db),
                            user=Depends(auth_routes.get_current_user)):
    patient_or_404(db, checkin.patient_id); require_patient_access(db, user, checkin.patient_id); require_senior(user)
    exists = db.query(wellness_checkin_models.WellnessCheckIn).filter_by(
        patient_id=checkin.patient_id, checkin_date=checkin.checkin_date).first()
    if exists:
        raise HTTPException(status_code=400, detail="A wellness check-in already exists for this patient and date")
    item = wellness_checkin_models.WellnessCheckIn(**checkin.model_dump())
    db.add(item); db.flush(); audit(db, user, item.patient_id, "create_wellness_checkin", "wellness_checkin", item.id)
    db.commit(); db.refresh(item)
    return {"message": "Daily wellness check-in scheduled successfully", "checkin_id": item.id,
            "patient_id": item.patient_id, "checkin_date": item.checkin_date, "due_time": str(item.due_time),
            "escalation_delay_minutes": item.escalation_delay_minutes, "status": item.status}


@app.get("/patients/{patient_id}/wellness-checkins")
def get_patient_wellness_checkins(patient_id: int, db: Session = Depends(get_db),
                                  user=Depends(auth_routes.get_current_user)):
    patient_or_404(db, patient_id); require_patient_access(db, user, patient_id, "can_view_wellness")
    rows = db.query(wellness_checkin_models.WellnessCheckIn).filter(
        wellness_checkin_models.WellnessCheckIn.patient_id == patient_id).order_by(
        wellness_checkin_models.WellnessCheckIn.checkin_date.desc()).all()
    audit(db, user, patient_id, "view_wellness_checkins", "wellness_checkin"); db.commit()
    return rows


@app.post("/wellness-checkins/{checkin_id}/complete")
def complete_wellness_checkin(checkin_id: int, db: Session = Depends(get_db),
                              user=Depends(auth_routes.get_current_user)):
    item = db.query(wellness_checkin_models.WellnessCheckIn).filter(
        wellness_checkin_models.WellnessCheckIn.id == checkin_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Wellness check-in not found")
    require_patient_access(db, user, item.patient_id); require_senior(user)
    if item.status == "checked_in":
        raise HTTPException(status_code=400, detail="Wellness check-in has already been completed")
    item.status = "checked_in"; item.checked_in_at = datetime.now(IST).replace(tzinfo=None)
    audit(db, user, item.patient_id, "complete_wellness_checkin", "wellness_checkin", item.id)
    db.commit(); db.refresh(item)
    return {"message": "Wellness check-in completed successfully", "checkin_id": item.id,
            "patient_id": item.patient_id, "status": item.status, "checked_in_at": item.checked_in_at}


@app.post("/emergency-contacts")
def create_emergency_contact(contact: schemas.EmergencyContactCreate, db: Session = Depends(get_db),
                             user=Depends(auth_routes.get_current_user)):
    patient_or_404(db, contact.patient_id); require_patient_access(db, user, contact.patient_id); require_senior(user)
    item = emergency_models.EmergencyContact(**contact.model_dump())
    db.add(item); db.flush(); audit(db, user, item.patient_id, "create_emergency_contact", "emergency_contact", item.id)
    db.commit(); db.refresh(item); return item


@app.get("/patients/{patient_id}/emergency-contacts")
def get_emergency_contacts(patient_id: int, db: Session = Depends(get_db),
                           user=Depends(auth_routes.get_current_user)):
    patient_or_404(db, patient_id); require_patient_access(db, user, patient_id, "can_view_emergency")
    rows = db.query(emergency_models.EmergencyContact).filter(
        emergency_models.EmergencyContact.patient_id == patient_id).all()
    audit(db, user, patient_id, "view_emergency_contacts", "emergency_contact"); db.commit(); return rows


@app.post("/medical-profile")
def create_medical_profile(profile: schemas.MedicalProfileCreate, db: Session = Depends(get_db),
                           user=Depends(auth_routes.get_current_user)):
    patient_or_404(db, profile.patient_id); require_patient_access(db, user, profile.patient_id); require_senior(user)
    item = db.query(emergency_models.MedicalProfile).filter_by(patient_id=profile.patient_id).first()
    if not item:
        item = emergency_models.MedicalProfile(patient_id=profile.patient_id)
        db.add(item)
    for key, value in profile.model_dump(exclude={"patient_id"}).items():
        setattr(item, key, value)
    db.flush(); audit(db, user, profile.patient_id, "upsert_medical_profile", "medical_profile", item.id)
    db.commit(); db.refresh(item); return item


@app.get("/patients/{patient_id}/medical-profile")
def get_medical_profile(patient_id: int, db: Session = Depends(get_db),
                        user=Depends(auth_routes.get_current_user)):
    patient_or_404(db, patient_id); require_patient_access(db, user, patient_id, "can_view_medical_profile")
    item = db.query(emergency_models.MedicalProfile).filter_by(patient_id=patient_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Medical profile not found")
    audit(db, user, patient_id, "view_medical_profile", "medical_profile", item.id); db.commit(); return item


@app.post("/emergency/trigger")
def trigger_emergency(request: schemas.EmergencyTriggerCreate, db: Session = Depends(get_db),
                      user=Depends(auth_routes.get_current_user)):
    patient_or_404(db, request.patient_id); require_patient_access(db, user, request.patient_id); require_senior(user)
    contacts = db.query(emergency_models.EmergencyContact).filter(
        emergency_models.EmergencyContact.patient_id == request.patient_id,
        emergency_models.EmergencyContact.receives_emergency_alerts.is_(True)).all()
    if not contacts:
        raise HTTPException(status_code=400, detail="No emergency contacts configured to receive alerts")
    for contact in contacts:
        db.add(emergency_models.EmergencyAlert(patient_id=request.patient_id,
            emergency_contact_id=contact.id, message=request.message, status="pending"))
    audit(db, user, request.patient_id, "trigger_emergency", "emergency_alert")
    db.commit()
    return {"message": "Emergency activation recorded. External calls and messages have not been sent.",
            "patient_id": request.patient_id, "alerts_created": len(contacts),
            "call_options": [{"contact_id": c.id, "name": c.full_name, "phone": c.phone} for c in contacts]}


@app.get("/patients/{patient_id}/emergency-alerts")
def get_emergency_alerts(patient_id: int, db: Session = Depends(get_db),
                         user=Depends(auth_routes.get_current_user)):
    patient_or_404(db, patient_id); require_patient_access(db, user, patient_id, "can_view_emergency")
    rows = db.query(emergency_models.EmergencyAlert).filter(
        emergency_models.EmergencyAlert.patient_id == patient_id).order_by(
        emergency_models.EmergencyAlert.created_at.desc()).all()
    audit(db, user, patient_id, "view_emergency_alerts", "emergency_alert"); db.commit(); return rows


@app.get("/patients/{patient_id}/audit-logs")
def get_audit_logs(patient_id: int, db: Session = Depends(get_db),
                   user=Depends(auth_routes.get_current_user)):
    patient_or_404(db, patient_id); require_patient_access(db, user, patient_id); require_senior(user)
    return db.query(audit_models.AuditLog).filter(
        audit_models.AuditLog.patient_id == patient_id).order_by(
        audit_models.AuditLog.created_at.desc()).limit(500).all()
