from datetime import date, time
from pydantic import BaseModel, EmailStr, Field, ConfigDict


class PatientCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=150)
    email: EmailStr


class MedicationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    dosage: str
    frequency: str = Field(pattern="^(Once daily|Twice daily|Three times daily|Custom daily schedule)$")
    reminder_time: time | None = None
    reminder_times: list[time] | None = None
    is_critical: bool = False
    grace_period_minutes: int = Field(default=30, ge=1, le=1440)
    food_instructions: str | None = None


class MedicationUpdate(BaseModel):
    name: str
    dosage: str
    frequency: str = Field(pattern="^(Once daily|Twice daily|Three times daily|Custom daily schedule)$")
    reminder_times: list[time] = Field(min_length=1, max_length=12)
    is_critical: bool = False
    grace_period_minutes: int = Field(default=30, ge=1, le=1440)
    food_instructions: str | None = None


class MedicationScheduleCreate(BaseModel):
    reminder_time: time


class CaregiverCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=150)
    email: EmailStr
    phone: str | None = None
    patient_id: int
    relationship: str | None = None


class MedicationRefillCreate(BaseModel):
    refill_date: date
    pharmacy_name: str | None = None
    pharmacy_phone: str | None = None


class RefillStatusUpdate(BaseModel):
    status: str = Field(pattern="^(pending|completed)$")


class AppointmentCreate(BaseModel):
    patient_id: int
    title: str
    appointment_type: str
    appointment_date: date
    appointment_time: time | None = None
    location: str | None = None
    notes: str | None = None


class WellnessCheckInCreate(BaseModel):
    patient_id: int
    checkin_date: date
    due_time: time
    escalation_delay_minutes: int = Field(default=60, ge=1, le=1440)


class EmergencyContactCreate(BaseModel):
    patient_id: int
    full_name: str
    relationship: str | None = None
    phone: str
    email: EmailStr | None = None
    is_primary: bool = False
    receives_emergency_alerts: bool = True


class MedicalProfileCreate(BaseModel):
    patient_id: int
    blood_group: str | None = None
    allergies: str | None = None
    medical_conditions: str | None = None
    physician_name: str | None = None
    physician_phone: str | None = None
    physician_address: str | None = None
    insurance_provider: str | None = None
    insurance_policy_number: str | None = None
    insurance_member_id: str | None = None


class EmergencyTriggerCreate(BaseModel):
    patient_id: int
    message: str = Field(default="Emergency assistance required. Please contact the patient immediately.", max_length=1000)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: str
    patient_id: int | None = None
    caregiver_id: int | None = None


class SeniorRegisterRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=150)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class CaregiverInviteRegisterRequest(BaseModel):
    invitation_code: str = Field(min_length=32, max_length=128)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str


class CaregiverPermissionUpdate(BaseModel):
    can_view_medications: bool = False
    can_view_appointments: bool = False
    can_view_wellness: bool = False
    can_view_emergency: bool = False
    can_view_medical_profile: bool = False
    can_receive_alerts: bool = False


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)
