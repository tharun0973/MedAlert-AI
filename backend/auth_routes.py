from datetime import timedelta
import hashlib

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

import auth_models
import invitation_models
import models
import schemas
from auth import hash_password, verify_password, create_access_token, decode_access_token
from database import SessionLocal
from time_utils import utcnow_naive

router = APIRouter(prefix="/auth", tags=["Authentication"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post("/register")
def register(data: schemas.RegisterRequest, db: Session = Depends(get_db)):
    email = data.email.strip().lower()
    raise HTTPException(
        status_code=410,
        detail="Use /auth/register/senior for senior registration or /auth/register/caregiver for an invited caregiver.",
    )


@router.post("/register/senior")
def register_senior(data: schemas.SeniorRegisterRequest, db: Session = Depends(get_db)):
    email = str(data.email).strip().lower()
    if db.query(auth_models.UserAccount).filter(auth_models.UserAccount.email == email).first() or \
            db.query(models.Patient).filter(models.Patient.email == email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    patient = models.Patient(full_name=data.full_name.strip(), email=email)
    db.add(patient)
    db.flush()
    account = auth_models.UserAccount(
        email=email,
        password_hash=hash_password(data.password),
        role="senior",
        patient_id=patient.id,
    )
    db.add(account)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=400, detail="Unable to register this email address")
    db.refresh(patient)
    db.refresh(account)
    return {
        "message": "Senior account registered successfully",
        "account_id": account.id,
        "role": account.role,
        "patient_id": patient.id,
    }


@router.post("/register/caregiver")
def register_caregiver(data: schemas.CaregiverInviteRegisterRequest, db: Session = Depends(get_db)):
    email = str(data.email).strip().lower()
    if db.query(auth_models.UserAccount).filter(auth_models.UserAccount.email == email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    token_hash = hashlib.sha256(data.invitation_code.encode("utf-8")).hexdigest()
    invitation = db.query(invitation_models.CaregiverInvitation).filter_by(token_hash=token_hash).first()
    now = utcnow_naive()
    if not invitation or invitation.used_at or invitation.expires_at <= now:
        raise HTTPException(status_code=400, detail="Caregiver invitation is invalid or expired")

    caregiver = db.query(models.Caregiver).filter_by(id=invitation.caregiver_id).first()
    if not caregiver or caregiver.email.strip().lower() != email:
        raise HTTPException(status_code=400, detail="Invitation does not match this caregiver email")

    account = auth_models.UserAccount(
        email=email,
        password_hash=hash_password(data.password),
        role="caregiver",
        caregiver_id=caregiver.id,
    )
    invitation.used_at = now
    db.add(account)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=400, detail="Unable to register this caregiver account")
    db.refresh(account)
    return {"message": "Caregiver account registered successfully", "account_id": account.id, "role": account.role}


@router.post("/login", response_model=schemas.TokenResponse)
def login(data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    email = data.username.strip().lower()
    account = db.query(auth_models.UserAccount).filter(auth_models.UserAccount.email == email).first()
    if not account or not verify_password(data.password, account.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not account.is_active:
        raise HTTPException(status_code=403, detail="Account is inactive")
    token = create_access_token({"sub": str(account.id)})
    return {"access_token": token, "token_type": "bearer", "role": account.role}


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    try:
        payload = decode_access_token(token)
        account_id = int(payload.get("sub"))
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    account = db.query(auth_models.UserAccount).filter(auth_models.UserAccount.id == account_id).first()
    if not account or not account.is_active:
        raise HTTPException(status_code=401, detail="Account not found or inactive")
    return account


@router.get("/me")
def get_my_account(current_user: auth_models.UserAccount = Depends(get_current_user)):
    return {
        "account_id": current_user.id,
        "email": current_user.email,
        "role": current_user.role,
        "patient_id": current_user.patient_id,
        "caregiver_id": current_user.caregiver_id,
    }
