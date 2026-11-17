import importlib
from datetime import datetime, timedelta
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import models
import schedule_models
import medication_dose_models


@pytest.fixture()
def test_environment(monkeypatch):
    import database

    # Import application modules and all database models.
    import main
    import auth_routes
    import scheduler
    import models
    import auth_models
    import medication_models
    import schedule_models
    import medication_dose_models
    import permission_models
    import refill_models
    import appointment_models
    import wellness_checkin_models
    import emergency_models
    import audit_models

    # Create an isolated in-memory SQLite database.
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    TestSessionLocal = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=test_engine,
        expire_on_commit=False,
    )

    database.engine = test_engine
    database.SessionLocal = TestSessionLocal

    # Patch every module that imported SessionLocal directly.
    main.engine = test_engine
    main.SessionLocal = TestSessionLocal
    auth_routes.SessionLocal = TestSessionLocal
    scheduler.SessionLocal = TestSessionLocal

    # Create tables only in the isolated database.
    database.Base.metadata.create_all(bind=test_engine)

    # Prevent the real background scheduler from starting.
    monkeypatch.setattr(scheduler, "start_scheduler", lambda: None)

    db = TestSessionLocal()

    patient = models.Patient(
        full_name="Integration Test Patient",
        email="integration.patient@example.com",
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)

    senior = auth_models.UserAccount(
        email="integration.patient@example.com",
        password_hash="test-hash",
        role="senior",
        patient_id=patient.id,
        is_active=True,
    )
    db.add(senior)

    caregiver = models.Caregiver(
        full_name="Integration Test Caregiver",
        email="integration.caregiver@example.com",
        phone="9999999999",
        patient_id=patient.id,
        relationship="Family",
    )
    db.add(caregiver)
    db.commit()
    db.refresh(caregiver)

    caregiver_account = auth_models.UserAccount(
        email="integration.caregiver@example.com",
        password_hash="test-hash",
        role="caregiver",
        caregiver_id=caregiver.id,
        is_active=True,
    )
    db.add(caregiver_account)
    db.commit()
    db.refresh(senior)
    db.refresh(caregiver_account)

    db.close()

    current_user = {"account": senior}

    main.app.dependency_overrides[auth_routes.get_current_user] = (
        lambda: current_user["account"]
    )

    # TestClient startup is safe because the scheduler was disabled.
    with TestClient(main.app) as client:
        yield {
            "client": client,
            "db_factory": TestSessionLocal,
            "patient": patient,
            "senior": senior,
            "caregiver": caregiver,
            "caregiver_account": caregiver_account,
            "current_user": current_user,
            "scheduler": scheduler,
            "main": main,
        }

    main.app.dependency_overrides.clear()
    database.Base.metadata.drop_all(bind=test_engine)
    test_engine.dispose()


def test_medalert_backend_integration(test_environment):
    env = test_environment
    client = env["client"]
    db_factory = env["db_factory"]
    patient = env["patient"]
    caregiver = env["caregiver"]
    current_user = env["current_user"]
    scheduler = env["scheduler"]

    passed = []

    def check(name, response, expected=(200, 201)):
        assert response.status_code in expected, (
            f"{name} failed: HTTP {response.status_code}: {response.text}"
        )
        passed.append(name)
        return response

    # 1. Home and patient access.
    check("Home endpoint", client.get("/"))
    check("Get patient", client.get(f"/patients/{patient.id}"))

    # 2. Medication creation and listing.
    medication = check(
        "Create medication",
        client.post(
            f"/patients/{patient.id}/medications",
            json={
                "name": "Integration Test Medication",
                "dosage": "1 tablet",
                "frequency": "Once daily",
                "reminder_time": "08:00:00",
                "is_critical": True,
                "grace_period_minutes": 1,
                "food_instructions": "After food",
            },
        ),
    ).json()

    medication_id = medication["medication_id"]

    check(
        "List medications",
        client.get(f"/patients/{patient.id}/medications"),
    )

    # 3. Schedule creation and listing.
    schedule = check(
        "Create medication schedule",
        client.post(
            f"/medications/{medication_id}/schedules",
            json={"reminder_time": "08:00:00"},
        ),
    ).json()

    check(
        "List medication schedules",
        client.get(f"/medications/{medication_id}/schedules"),
    )

    # 4. Caregiver permission grant and revoke.
    permission_url = (
        f"/patients/{patient.id}/caregivers/{caregiver.id}/permissions"
    )

    check(
        "Grant caregiver alert permission",
        client.put(
            permission_url,
            json={
                "can_view_medications": False,
                "can_view_appointments": False,
                "can_view_wellness": False,
                "can_view_emergency": False,
                "can_view_medical_profile": False,
                "can_receive_alerts": True,
            },
        ),
    )

    check(
        "List caregivers",
        client.get(f"/patients/{patient.id}/caregivers"),
    )

    # 5. Trigger the scheduler with an overdue critical medication.
    db = db_factory()
    schedule_record = (
        db.query(schedule_models.MedicationSchedule)
        .filter_by(id=schedule["schedule_id"])
        .first()
    )

    schedule_record.reminder_time = (
        datetime.now(ZoneInfo("Asia/Kolkata")).replace(tzinfo=None)
        - timedelta(minutes=3)
    ).time()
    db.commit()
    db.close()

    scheduler.check_medication_reminders()
    scheduler.check_medication_reminders()

    db = db_factory()
    doses = (
        db.query(medication_dose_models.MedicationDose)
        .filter_by(schedule_id=schedule["schedule_id"])
        .all()
    )

    assert len(doses) == 1, "Scheduler created duplicate medication doses"
    assert doses[0].status == "missed", "Overdue critical dose was not marked missed"

    alerts = (
        db.query(models.CaregiverAlert)
        .filter_by(
            dose_id=doses[0].id,
            caregiver_id=caregiver.id,
        )
        .all()
    )

    assert len(alerts) == 1, "Scheduler created duplicate caregiver alerts"
    db.close()
    passed.extend([
        "Scheduler creates medication dose",
        "Overdue dose marked missed",
        "Critical missed-dose caregiver alert",
        "Duplicate dose and alert prevention",
    ])

    # 6. Caregiver alert access and acknowledgement.
    current_user["account"] = env["caregiver_account"]

    alert_response = check(
        "Caregiver alert listing",
        client.get("/caregiver-alerts"),
    )

    alert_id = alerts[0].id

    check(
        "Caregiver alert acknowledgement",
        client.post(f"/caregiver-alerts/{alert_id}/acknowledge"),
    )

    current_user["account"] = env["senior"]

    # 7. Refill reminder.
    check(
        "Create medication refill",
        client.post(
            f"/medications/{medication_id}/refills",
            json={
                "refill_date": (
                    datetime.now(ZoneInfo("Asia/Kolkata")).date()
                    + timedelta(days=2)
                ).isoformat(),
                "pharmacy_name": "Test Pharmacy",
                "pharmacy_phone": "9999999999",
            },
        ),
    )

    check(
        "List medication refills",
        client.get(f"/medications/{medication_id}/refills"),
    )

    # 8. Appointment.
    tomorrow = (
        datetime.now(ZoneInfo("Asia/Kolkata")).date()
        + timedelta(days=1)
    )

    check(
        "Create appointment",
        client.post(
            "/appointments",
            json={
                "patient_id": patient.id,
                "title": "Integration Test Appointment",
                "appointment_type": "appointment",
                "appointment_date": tomorrow.isoformat(),
                "appointment_time": "10:00:00",
                "location": "Test Clinic",
                "notes": "Automated integration test",
            },
        ),
    )

    check(
        "List appointments",
        client.get(f"/patients/{patient.id}/appointments"),
    )

    # 9. Wellness check-in.
    checkin = check(
        "Create wellness check-in",
        client.post(
            "/wellness-checkins",
            json={
                "patient_id": patient.id,
                "checkin_date": tomorrow.isoformat(),
                "due_time": "09:00:00",
                "escalation_delay_minutes": 60,
            },
        ),
    ).json()

    check(
        "List wellness check-ins",
        client.get(f"/patients/{patient.id}/wellness-checkins"),
    )

    check(
        "Complete wellness check-in",
        client.post(
            f"/wellness-checkins/{checkin['checkin_id']}/complete"
        ),
    )

    # 10. Emergency contacts and medical profile.
    check(
        "Create emergency contact",
        client.post(
            "/emergency-contacts",
            json={
                "patient_id": patient.id,
                "full_name": "Test Emergency Contact",
                "relationship": "Family",
                "phone": "9999999999",
                "is_primary": True,
                "receives_emergency_alerts": True,
            },
        ),
    )

    check(
        "List emergency contacts",
        client.get(f"/patients/{patient.id}/emergency-contacts"),
    )

    check(
        "Create or update medical profile",
        client.post(
            "/medical-profile",
            json={
                "patient_id": patient.id,
                "blood_group": "O+",
                "allergies": "None",
                "medical_conditions": "None",
            },
        ),
    )

    check(
        "Get medical profile",
        client.get(f"/patients/{patient.id}/medical-profile"),
    )

    # 11. Emergency trigger and emergency alert listing.
    check(
        "Trigger emergency",
        client.post(
            "/emergency/trigger",
            json={
                "patient_id": patient.id,
                "message": "Integration test emergency",
            },
        ),
    )

    check(
        "List emergency alerts",
        client.get(f"/patients/{patient.id}/emergency-alerts"),
    )

    # 12. Audit log.
    check(
        "List patient audit logs",
        client.get(f"/patients/{patient.id}/audit-logs"),
    )

    # 13. Permission revocation.
    check(
        "Revoke caregiver permissions",
        client.delete(permission_url),
    )

    # 14. Caregiver must no longer access medication data.
    current_user["account"] = env["caregiver_account"]

    denied = client.get(f"/patients/{patient.id}/medications")
    assert denied.status_code == 403, (
        "Caregiver accessed medication data after permission revocation: "
        f"HTTP {denied.status_code}"
    )
    passed.append("Caregiver access denied after permission revocation")

    current_user["account"] = env["senior"]

    print("\n========== MEDALERT AI TEST REPORT ==========")
    for item in passed:
        print(f"PASS  {item}")
    print("---------------------------------------------")
    print(f"PASSED: {len(passed)}")
    print("FAILED: 0")
    print("=============================================")
