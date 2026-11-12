from apscheduler.schedulers.background import BackgroundScheduler

scheduler = BackgroundScheduler(timezone="Asia/Kolkata")


def check_medication_reminders():
    print("Checking medication reminders...")


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