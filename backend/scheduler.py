from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.exc import IntegrityError

from database import SessionLocal
import appointment_models
import auth_models
import medication_dose_models
import medication_models
import models
import permission_models
import refill_models
import schedule_models
import wellness_checkin_models

IST = ZoneInfo("Asia/Kolkata")
scheduler = BackgroundScheduler(timezone="Asia/Kolkata")


def check_medication_reminders():
    db = SessionLocal()
    try:
        now = datetime.now(IST).replace(tzinfo=None)
        today = now.date()

        for schedule in db.query(schedule_models.MedicationSchedule).all():
            scheduled_for = datetime.combine(today, schedule.reminder_time)
            if scheduled_for > now:
                continue
            exists = db.query(medication_dose_models.MedicationDose).filter_by(
                schedule_id=schedule.id, scheduled_for=scheduled_for).first()
            if not exists:
                db.add(medication_dose_models.MedicationDose(
                    schedule_id=schedule.id, scheduled_for=scheduled_for, status="pending"))
                try:
                    db.commit()
                except IntegrityError:
                    db.rollback()

        active_patient_ids = {
            row.patient_id for row in db.query(auth_models.UserAccount).filter_by(
                role="senior", is_active=True
            ).all() if row.patient_id
        }
        for patient_id in active_patient_ids:
            exists = db.query(wellness_checkin_models.WellnessCheckIn).filter_by(
                patient_id=patient_id, checkin_date=today
            ).first()
            if not exists:
                db.add(wellness_checkin_models.WellnessCheckIn(
                    patient_id=patient_id,
                    checkin_date=today,
                    due_time=time(20, 0),
                    escalation_delay_minutes=60,
                    status="pending",
                ))
        db.commit()

        pending = db.query(medication_dose_models.MedicationDose).filter_by(status="pending").all()
        for dose in pending:
            schedule = db.query(schedule_models.MedicationSchedule).filter_by(id=dose.schedule_id).first()
            if not schedule:
                continue
            med = db.query(medication_models.Medication).filter_by(id=schedule.medication_id).first()
            if not med:
                continue
            base = dose.snoozed_until or dose.scheduled_for
            deadline = base + timedelta(minutes=med.grace_period_minutes or 30)
            if now >= deadline:
                dose.status = "missed"
                if med.is_critical:
                    caregivers = db.query(models.Caregiver).filter_by(patient_id=med.patient_id).all()
                    for caregiver in caregivers:
                        permission = db.query(permission_models.CaregiverPermission).filter_by(
                            patient_id=med.patient_id, caregiver_id=caregiver.id, is_active=True).first()
                        if not permission or not permission.can_receive_alerts:
                            continue
                        exists = db.query(models.CaregiverAlert).filter_by(
                            dose_id=dose.id, caregiver_id=caregiver.id).first()
                        if not exists:
                            db.add(models.CaregiverAlert(
                                patient_id=med.patient_id, caregiver_id=caregiver.id, dose_id=dose.id,
                                message=f"Critical medication {med.name} was missed. Please check on the patient.",
                                status="pending"))
            elif now >= base + timedelta(minutes=15) and dose.second_reminder_sent_at is None:
                dose.second_reminder_sent_at = now

        refills = db.query(refill_models.MedicationRefill).filter(
            refill_models.MedicationRefill.status == "pending",
            refill_models.MedicationRefill.reminder_sent_at.is_(None),
            refill_models.MedicationRefill.refill_date <= today + timedelta(days=5)).all()
        for refill in refills:
            refill.reminder_sent_at = now

        tomorrow = today + timedelta(days=1)
        appointments = db.query(appointment_models.Appointment).filter(
            appointment_models.Appointment.status == "scheduled",
            appointment_models.Appointment.reminder_sent_at.is_(None),
            appointment_models.Appointment.appointment_date == tomorrow).all()
        for appointment in appointments:
            appointment.reminder_sent_at = now

        checkins = db.query(wellness_checkin_models.WellnessCheckIn).filter(
            wellness_checkin_models.WellnessCheckIn.status == "pending",
            wellness_checkin_models.WellnessCheckIn.checkin_date == today,
            wellness_checkin_models.WellnessCheckIn.checked_in_at.is_(None),
            wellness_checkin_models.WellnessCheckIn.caregiver_alert_sent_at.is_(None)).all()
        for checkin in checkins:
            due = datetime.combine(today, checkin.due_time)
            if now < due + timedelta(minutes=checkin.escalation_delay_minutes):
                continue
            checkin.status = "missed"
            caregivers = db.query(models.Caregiver).filter_by(patient_id=checkin.patient_id).all()
            sent = False
            for caregiver in caregivers:
                permission = db.query(permission_models.CaregiverPermission).filter_by(
                    patient_id=checkin.patient_id, caregiver_id=caregiver.id, is_active=True).first()
                if not permission or not permission.can_receive_alerts:
                    continue
                db.add(models.CaregiverAlert(
                    patient_id=checkin.patient_id, caregiver_id=caregiver.id, dose_id=None,
                    message="Patient missed the daily wellness check-in. Please check on the patient.",
                    status="pending"))
                sent = True
            if sent:
                checkin.caregiver_alert_sent_at = now
        db.commit()
    except Exception as exc:
        db.rollback()
        print(f"Reminder scheduler error: {exc}")
    finally:
        db.close()


def start_scheduler():
    if not scheduler.running:
        scheduler.add_job(check_medication_reminders, "interval", minutes=1,
                          id="medication_reminder_check", replace_existing=True)
        scheduler.start()
