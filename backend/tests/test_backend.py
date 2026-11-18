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
    assert client.post(f"/medications/{medication_id}/schedules", json={"reminder_time": "08:00:00"}).status_code == 400

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

    appointment = check(
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
    ).json()

    appointment_update = check(
        "Update appointment",
        client.put(f"/appointments/{appointment['appointment_id']}", json={
            "patient_id": patient.id,
            "title": "Updated Integration Appointment",
            "appointment_type": "appointment",
            "appointment_date": (tomorrow + timedelta(days=1)).isoformat(),
            "appointment_time": "11:00:00",
            "location": "Updated Test Clinic",
            "notes": "Updated note",
        }),
    ).json()
    assert appointment_update["title"] == "Updated Integration Appointment"

    check(
        "List appointments",
        client.get(f"/patients/{patient.id}/appointments"),
    )
    current_user["account"] = env["caregiver_account"]
    assert client.put(f"/appointments/{appointment['appointment_id']}", json={
        "patient_id": patient.id,
        "title": "Not allowed",
        "appointment_type": "appointment",
        "appointment_date": tomorrow.isoformat(),
    }).status_code == 403
    current_user["account"] = env["senior"]
    check("Delete appointment", client.delete(f"/appointments/{appointment['appointment_id']}"))

    check(
        "Create lab test reminder",
        client.post("/appointments", json={
            "patient_id": patient.id,
            "title": "Integration Test Lab",
            "appointment_type": "lab_test",
            "appointment_date": tomorrow.isoformat(),
            "appointment_time": "11:00:00",
        }),
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
    contact = check(
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
    ).json()
    assert contact["full_name"] == "Test Emergency Contact"
    assert contact["phone"] == "9999999999"
    assert contact["is_primary"] is True

    contacts = check(
        "List emergency contacts",
        client.get(f"/patients/{patient.id}/emergency-contacts"),
    ).json()
    assert any(
        row["id"] == contact["id"]
        and row["full_name"] == "Test Emergency Contact"
        and row["phone"] == "9999999999"
        for row in contacts
    ), "Emergency contact was not persisted and returned by a new API request"
    passed.append("Emergency contact persists across API requests")

    missing_profile = client.get(f"/patients/{patient.id}/medical-profile")
    assert missing_profile.status_code == 404, missing_profile.text
    passed.append("Missing medical profile returns the expected not-found response")

    profile = check(
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
    ).json()
    assert profile["blood_group"] == "O+"
    assert profile["allergies"] == "None"

    restored_profile = check(
        "Get medical profile",
        client.get(f"/patients/{patient.id}/medical-profile"),
    ).json()
    assert restored_profile["id"] == profile["id"]
    assert restored_profile["blood_group"] == "O+"
    assert restored_profile["allergies"] == "None"
    assert restored_profile["medical_conditions"] == "None"
    passed.append("Medical profile persists across API requests")
    updated_profile = check("Update medical profile", client.post("/medical-profile", json={
        "patient_id": patient.id, "blood_group": "O+", "allergies": "Pollen", "medical_conditions": "Updated condition",
    })).json()
    assert updated_profile["id"] == profile["id"]
    assert client.get(f"/patients/{patient.id}/medical-profile").json()["medical_conditions"] == "Updated condition"

    current_user["account"] = env["caregiver_account"]
    denied_contacts = client.get(f"/patients/{patient.id}/emergency-contacts")
    denied_profile = client.get(f"/patients/{patient.id}/medical-profile")
    assert denied_contacts.status_code == 403, denied_contacts.text
    assert denied_profile.status_code == 403, denied_profile.text
    passed.append("Caregiver emergency and medical profile permissions enforced")
    current_user["account"] = env["senior"]

    # 11. Emergency trigger and emergency alert listing.
    non_recipient = client.post("/emergency-contacts", json={
        "patient_id": patient.id, "full_name": "No Alert Contact", "phone": "5550000",
        "receives_emergency_alerts": False,
    }).json()
    trigger_result = check(
        "Trigger emergency",
        client.post(
            "/emergency/trigger",
            json={
                "patient_id": patient.id,
                "message": "Integration test emergency",
            },
        ),
    ).json()
    assert trigger_result["alerts_created"] == 1

    emergency_alerts = check(
        "List emergency alerts",
        client.get(f"/patients/{patient.id}/emergency-alerts"),
    ).json()
    assert len(emergency_alerts) == 1
    assert emergency_alerts[0]["emergency_contact_id"] != non_recipient["id"]

    # 12. Audit log.
    audit_entries = check(
        "List patient audit logs",
        client.get(f"/patients/{patient.id}/audit-logs"),
    ).json()
    assert any(entry["action"] == "trigger_emergency" for entry in audit_entries)

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


def test_mvp_photo_refill_permissions_and_daily_checkin(test_environment):
    env = test_environment
    client, db_factory = env["client"], env["db_factory"]
    patient, caregiver = env["patient"], env["caregiver"]
    current_user, scheduler = env["current_user"], env["scheduler"]

    medication = client.post(f"/patients/{patient.id}/medications", json={
        "name": "Photo Test Medication", "dosage": "1 tablet", "frequency": "Once daily",
        "reminder_time": "08:00:00", "reminder_times": ["08:00:00"], "is_critical": False,
    })
    assert medication.status_code == 200, medication.text
    med_id = medication.json()["medication_id"]
    assert len(client.get(f"/medications/{med_id}/schedules").json()) == 1
    assert client.post(f"/medications/{med_id}/schedules", json={"reminder_time": "08:00:00"}).status_code == 400
    duplicate_times = client.post(f"/patients/{patient.id}/medications", json={
        "name": "Invalid Duplicate Time", "dosage": "1 tablet", "frequency": "Twice daily",
        "reminder_times": ["09:00:00", "09:00:00"],
    })
    assert duplicate_times.status_code == 400
    dose_statuses = []
    for action, expected in (("taken", "taken"), ("delayed", "delayed"), ("skipped", "skipped")):
        schedule = client.post(f"/medications/{med_id}/schedules", json={"reminder_time": f"{11 + len(dose_statuses):02d}:00:00"})
        assert schedule.status_code == 200, schedule.text
        db = db_factory()
        dose = medication_dose_models.MedicationDose(
            schedule_id=schedule.json()["schedule_id"],
            scheduled_for=datetime.now(ZoneInfo("Asia/Kolkata")).replace(tzinfo=None) + timedelta(minutes=len(dose_statuses)),
            status="pending",
        )
        db.add(dose); db.commit(); db.refresh(dose); dose_id = dose.id; db.close()
        action_response = client.post(f"/medication-doses/{dose_id}/{action}")
        assert action_response.status_code == 200 and action_response.json()["status"] == expected
        assert client.post(f"/medication-doses/{dose_id}/{action}").status_code == 400
        dose_statuses.append(expected)
    assert [item["status"] for item in client.get("/medication-doses?status=all").json()] == ["skipped", "delayed", "taken"]
    med_update = client.put(f"/medications/{med_id}", json={
        "name": "Photo Test Medication", "dosage": "2 tablets", "frequency": "Custom daily schedule",
        "reminder_times": ["08:00:00", "11:00:00", "12:00:00", "13:00:00"], "is_critical": True,
        "grace_period_minutes": 45, "food_instructions": "With water",
    })
    assert med_update.status_code == 200, med_update.text
    assert client.put(f"/medications/{med_id}", json={
        "name": "Photo Test Medication", "dosage": "2 tablets", "frequency": "Once daily",
        "reminder_times": ["14:00:00"],
    }).status_code == 409
    duplicate_med = client.post(f"/patients/{patient.id}/medications", json={
        "name": "Photo Test Medication", "dosage": "2 tablets", "frequency": "Once daily", "reminder_time": "14:00:00",
    })
    assert duplicate_med.status_code == 409
    snooze_schedule = client.post(f"/medications/{med_id}/schedules", json={"reminder_time": "14:00:00"})
    assert snooze_schedule.status_code == 200, snooze_schedule.text
    db = db_factory()
    snooze_dose = medication_dose_models.MedicationDose(
        schedule_id=snooze_schedule.json()["schedule_id"],
        scheduled_for=datetime.now(ZoneInfo("Asia/Kolkata")).replace(tzinfo=None) + timedelta(hours=1),
        status="pending",
    )
    db.add(snooze_dose); db.commit(); db.refresh(snooze_dose); snooze_dose_id = snooze_dose.id; db.close()
    snoozed = client.post(f"/medication-doses/{snooze_dose_id}/snooze?snooze_minutes=10")
    assert snoozed.status_code == 200 and snoozed.json()["snoozed_until"]
    assert client.post(f"/medication-doses/{snooze_dose_id}/snooze?snooze_minutes=0").status_code == 400
    png_header = b"\x89PNG\r\n\x1a\nsynthetic-test-image"
    uploaded = client.post(f"/medications/{med_id}/photo", files={"file": ("test.png", png_header, "image/png")})
    assert uploaded.status_code == 200, uploaded.text
    assert client.get(f"/medications/{med_id}/photo").content == png_header
    rejected = client.post(f"/medications/{med_id}/photo", files={"file": ("bad.png", b"not png", "image/png")})
    assert rejected.status_code == 400

    permission_url = f"/patients/{patient.id}/caregivers/{caregiver.id}/permissions"
    permission = {"can_view_medications": False, "can_view_appointments": False, "can_view_wellness": False,
                  "can_view_emergency": False, "can_view_medical_profile": False, "can_receive_alerts": False}
    assert client.put(permission_url, json=permission).status_code == 200
    current_user["account"] = env["caregiver_account"]
    assert client.get(f"/medications/{med_id}/photo").status_code == 403
    assert client.post(f"/patients/{patient.id}/medications", json={"name":"Denied","dosage":"1","frequency":"Once daily","reminder_time":"09:00:00"}).status_code == 403
    current_user["account"] = env["senior"]

    refill = client.post(f"/medications/{med_id}/refills", json={"refill_date": (datetime.now(ZoneInfo("Asia/Kolkata")).date() + timedelta(days=3)).isoformat()})
    assert refill.status_code == 200, refill.text
    refill_id = refill.json()["refill_id"]
    assert client.put(f"/medication-refills/{refill_id}", json={"status":"completed"}).json()["status"] == "completed"
    assert client.get(f"/medications/{med_id}/refills").json()[0]["status"] == "completed"
    assert client.put(f"/medication-refills/{refill_id}", json={"status":"bad"}).status_code == 422

    today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
    scheduler.check_medication_reminders()
    scheduler.check_medication_reminders()
    checkins = client.get(f"/patients/{patient.id}/wellness-checkins").json()
    assert sum(row["checkin_date"][:10] == today.isoformat() for row in checkins) == 1
    assert any(row["checkin_date"][:10] == today.isoformat() and row["status"] == "pending" for row in checkins)

    permission_url = f"/patients/{patient.id}/caregivers/{caregiver.id}/permissions"
    permissions = {"can_view_medications": False, "can_view_appointments": False, "can_view_wellness": False,
                   "can_view_emergency": False, "can_view_medical_profile": False, "can_receive_alerts": True}
    assert client.put(permission_url, json=permissions).status_code == 200
    db = db_factory()
    checkin_model = __import__("wellness_checkin_models").WellnessCheckIn
    todays_checkin = db.query(checkin_model).filter_by(patient_id=patient.id, checkin_date=today).first()
    from datetime import time
    now_local = datetime.now(ZoneInfo("Asia/Kolkata")).replace(tzinfo=None)
    overdue_time = (now_local - timedelta(minutes=62)).time()
    todays_checkin.due_time = overdue_time
    db.commit(); db.close()
    scheduler.check_medication_reminders()
    scheduler.check_medication_reminders()
    missed = client.get(f"/patients/{patient.id}/wellness-checkins").json()
    assert any(row["checkin_date"][:10] == today.isoformat() and row["status"] == "missed" for row in missed)
    current_user["account"] = env["caregiver_account"]
    missed_alerts = client.get("/caregiver-alerts")
    assert missed_alerts.status_code == 200
    assert sum("wellness check-in" in item["message"] for item in missed_alerts.json()) == 1
    current_user["account"] = env["senior"]

    db = db_factory()
    emergency_models = __import__("emergency_models")
    contacts = client.get(f"/patients/{patient.id}/emergency-contacts").json()
    if contacts:
        first_id = contacts[0]["id"]
    else:
        first_id = client.post("/emergency-contacts", json={"patient_id":patient.id,"full_name":"Primary A","phone":"1111111111","is_primary":True}).json()["id"]
    client.post("/emergency-contacts", json={"patient_id":patient.id,"full_name":"Primary B","phone":"2222222222","is_primary":True})
    db.expire_all()
    primary_count = db.query(emergency_models.EmergencyContact).filter_by(patient_id=patient.id, is_primary=True).count()
    assert primary_count == 1
    db.close()
    contact_id = next(row["id"] for row in client.get(f"/patients/{patient.id}/emergency-contacts").json() if row["full_name"] == "Primary B")
    updated_contact = client.put(f"/emergency-contacts/{contact_id}", json={
        "patient_id": patient.id, "full_name": "Primary B Updated", "phone": "2222222222", "is_primary": True,
        "receives_emergency_alerts": False,
    })
    assert updated_contact.status_code == 200 and updated_contact.json()["full_name"] == "Primary B Updated"
    assert client.delete(f"/emergency-contacts/{contact_id}").status_code == 200
    assert all(row["full_name"] != "Primary B Updated" for row in client.get(f"/patients/{patient.id}/emergency-contacts").json())
    assert client.delete(f"/medications/{med_id}").status_code == 200
    assert client.get(f"/patients/{patient.id}/medications").json() == []
    assert client.get(f"/medications/{med_id}/photo").status_code == 404
