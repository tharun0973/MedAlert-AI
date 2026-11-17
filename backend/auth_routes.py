from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

import auth_models
import models
import schemas
from auth import hash_password, verify_password, create_access_token, decode_access_token
from database import SessionLocal

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
    if data.role not in {"senior", "caregiver"}:
        raise HTTPException(status_code=400, detail="Invalid role")
    if db.query(auth_models.UserAccount).filter(auth_models.UserAccount.email == email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    if data.role == "senior":
        if not data.patient_id or data.caregiver_id is not None:
            raise HTTPException(status_code=400, detail="A valid patient_id is required")
        profile = db.query(models.Patient).filter(models.Patient.id == data.patient_id).first()
    else:
        if not data.caregiver_id or data.patient_id is not None:
            raise HTTPException(status_code=400, detail="A valid caregiver_id is required")
        profile = db.query(models.Caregiver).filter(models.Caregiver.id == data.caregiver_id).first()

    if not profile or profile.email.strip().lower() != email:
        raise HTTPException(status_code=404, detail="Matching patient or caregiver profile not found")

    account = auth_models.UserAccount(
        email=email,
        password_hash=hash_password(data.password),
        role=data.role,
        patient_id=data.patient_id,
        caregiver_id=data.caregiver_id,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return {"message": "Account registered successfully", "account_id": account.id, "role": account.role}


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
