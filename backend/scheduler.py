from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.exc import IntegrityError
from datetime import datetime
from zoneinfo import ZoneInfo

from database import SessionLocal
import schedule_models
import medication_dose_models


IST = ZoneInfo("Asia/Kolkata")

scheduler = BackgroundScheduler(timezone="Asia/Kolkata")


def check_medication_reminders():

    db = SessionLocal()

    try:
        now = datetime.now(IST).replace(tzinfo=None)
        today = now.date()

        schedules = db.query(
            schedule_models.MedicationSchedule
        ).all()

        for schedule in schedules:

            scheduled_for = datetime.combine(
                today,
                schedule.reminder_time
            )

            # Ignore medication times that are still in the future
            if scheduled_for > now:
                continue

            # Check whether this dose was already created
            existing_dose = db.query(
                medication_dose_models.MedicationDose
            ).filter(
                medication_dose_models.MedicationDose.schedule_id
                == schedule.id,
                medication_dose_models.MedicationDose.scheduled_for
                == scheduled_for
            ).first()

            if existing_dose:
                continue

            # Create a pending dose record
            new_dose = medication_dose_models.MedicationDose(
                schedule_id=schedule.id,
                scheduled_for=scheduled_for,
                status="pending"
            )

            db.add(new_dose)

            try:
                db.commit()
                print(
                    f"Medication dose created: "
                    f"Schedule {schedule.id}, "
                    f"Time {scheduled_for}"
                )

            except IntegrityError:
                db.rollback()
                print("Duplicate dose prevented.")

        print("Medication reminder check completed.")

    except Exception as error:
        db.rollback()
        print(f"Reminder scheduler error: {error}")

    finally:
        db.close()


def start_scheduler():

    if not scheduler.running:

        scheduler.add_job(
            check_medication_reminders,
            "interval",
            minutes=1,
            id="medication_reminder_check",
            replace_existing=True
        )

        scheduler.start()