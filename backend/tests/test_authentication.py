import os
import hashlib
from datetime import timedelta

os.environ.setdefault(
    "MEDALERT_SECRET_KEY",
    "medalert-test-secret-key-only-for-automated-tests-2026"
)

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture()
def auth_environment(monkeypatch):
    import database
    import main
    import auth_routes
    import scheduler
    import models
    import auth_models
    import invitation_models
    import auth
    import medication_models
    import schedule_models
    import medication_dose_models
    import permission_models
    import refill_models
    import appointment_models
    import wellness_checkin_models
    import emergency_models
    import audit_models

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
    main.engine = test_engine
    main.SessionLocal = TestSessionLocal
    auth_routes.SessionLocal = TestSessionLocal
    scheduler.SessionLocal = TestSessionLocal

    database.Base.metadata.create_all(bind=test_engine)

    monkeypatch.setattr(scheduler, "start_scheduler", lambda: None)

    db = TestSessionLocal()

    patient = models.Patient(
        full_name="Authentication Test Patient",
        email="auth.patient@example.com",
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)

    caregiver = models.Caregiver(
        full_name="Authentication Test Caregiver",
        email="auth.caregiver@example.com",
        phone="9999999999",
        patient_id=patient.id,
        relationship="Family",
    )
    db.add(caregiver)
    db.commit()
    db.refresh(caregiver)
    db.close()

    main.app.dependency_overrides.clear()

    try:
        with TestClient(main.app) as client:
            yield {
                "client": client,
                "patient": patient,
                "caregiver": caregiver,
                "db_factory": TestSessionLocal,
                "auth": auth,
                "auth_models": auth_models,
                "invitation_models": invitation_models,
                "models": models,
            }
    finally:
        main.app.dependency_overrides.clear()
        database.Base.metadata.drop_all(bind=test_engine)
        test_engine.dispose()


def test_senior_registration_login_and_jwt(auth_environment):
    env = auth_environment
    client = env["client"]

    password = "SeniorTestPassword2026"

    # Senior profile and account are created atomically.
    response = client.post(
        "/auth/register/senior",
        json={
            "full_name": "New Authentication Patient",
            "email": "NEW.SENIOR@example.com",
            "password": password,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["role"] == "senior"
    patient_id = response.json()["patient_id"]

    # Confirm password is hashed.
    db = env["db_factory"]()
    account = db.query(env["auth_models"].UserAccount).filter_by(email="new.senior@example.com").first()

    assert account is not None
    assert account.patient_id == patient_id
    assert account.password_hash != password
    assert env["auth"].verify_password(password, account.password_hash)
    db.close()

    # Duplicate registration must fail.
    duplicate = client.post(
        "/auth/register/senior",
        json={
            "full_name": "Duplicate Patient",
            "email": "new.senior@example.com",
            "password": password,
        },
    )
    assert duplicate.status_code == 400

    # The legacy public profile-creation and role-based registration routes are disabled.
    public_profile = client.post("/patients", json={"full_name": "Reserved", "email": "reserved@example.com"})
    assert public_profile.status_code == 410
    legacy_registration = client.post("/auth/register", json={
        "email": "auth.patient@example.com", "password": password, "role": "senior",
        "patient_id": env["patient"].id,
    })
    assert legacy_registration.status_code == 410

    # Login uses OAuth2 form fields.
    login = client.post(
        "/auth/login",
        data={
            "username": "NEW.SENIOR@example.com",
            "password": password,
        },
    )
    assert login.status_code == 200, login.text

    token_data = login.json()
    assert token_data["token_type"] == "bearer"
    assert token_data["role"] == "senior"

    token = token_data["access_token"]

    # JWT must decode to a valid account subject.
    payload = env["auth"].decode_access_token(token)
    assert payload["sub"] == str(response.json()["account_id"])

    # Authenticated account endpoint.
    me = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me.status_code == 200, me.text
    assert me.json()["email"] == "new.senior@example.com"
    assert me.json()["role"] == "senior"

    # Protected patient endpoint.
    patient_response = client.get(
        f"/patients/{patient_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert patient_response.status_code == 200, patient_response.text

    # Incorrect password must fail.
    wrong_password = client.post(
        "/auth/login",
        data={
            "username": "new.senior@example.com",
            "password": "IncorrectPassword2026",
        },
    )
    assert wrong_password.status_code == 401

    # Missing token must fail.
    unauthenticated = client.get("/auth/me")
    assert unauthenticated.status_code == 401

    # Invalid token must fail.
    invalid_token = client.get(
        "/auth/me",
        headers={"Authorization": "Bearer invalid.test.token"},
    )
    assert invalid_token.status_code == 401

    print("\nPASS Senior registration")
    print("PASS Password hashing and verification")
    print("PASS Duplicate registration prevention")
    print("PASS Senior login")
    print("PASS JWT generation and decoding")
    print("PASS Authenticated account endpoint")
    print("PASS Protected patient endpoint")
    print("PASS Incorrect password rejection")
    print("PASS Missing token rejection")
    print("PASS Invalid token rejection")


def test_caregiver_registration_and_login(auth_environment):
    env = auth_environment
    client = env["client"]
    caregiver = env["caregiver"]

    password = "CaregiverTestPassword2026"
    invitation_code = "caregiver-invitation-code-for-auth-test-2026"
    db = env["db_factory"]()
    inviter = env["auth_models"].UserAccount(
        email="inviter@example.com", password_hash="test-hash", role="senior",
        patient_id=env["patient"].id,
    )
    db.add(inviter)
    db.flush()
    invitation = env["invitation_models"].CaregiverInvitation(
        caregiver_id=caregiver.id,
        token_hash=hashlib.sha256(invitation_code.encode("utf-8")).hexdigest(),
        created_by_user_id=inviter.id,
        expires_at=__import__("time_utils").utcnow_naive() + timedelta(days=7),
    )
    db.add(invitation)
    db.commit()
    db.close()

    registration = client.post(
        "/auth/register/caregiver",
        json={
            "invitation_code": invitation_code,
            "email": "auth.caregiver@example.com",
            "password": password,
        },
    )
    assert registration.status_code == 200, registration.text
    assert registration.json()["role"] == "caregiver"
    reused = client.post("/auth/register/caregiver", json={
        "invitation_code": invitation_code,
        "email": "auth.caregiver@example.com",
        "password": password,
    })
    assert reused.status_code == 400

    login = client.post(
        "/auth/login",
        data={
            "username": "auth.caregiver@example.com",
            "password": password,
        },
    )
    assert login.status_code == 200, login.text

    token = login.json()["access_token"]

    me = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me.status_code == 200, me.text
    assert me.json()["role"] == "caregiver"
    assert me.json()["caregiver_id"] == caregiver.id

    print("\nPASS Caregiver registration")
    print("PASS Caregiver login")
    print("PASS Caregiver JWT authentication")
