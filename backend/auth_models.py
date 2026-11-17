from time_utils import utcnow_naive

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Boolean,
)

from database import Base


class UserAccount(Base):
    __tablename__ = "user_accounts"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(30), nullable=False)

    patient_id = Column(
        Integer,
        ForeignKey("patients.id"),
        nullable=True,
        unique=True,
    )

    caregiver_id = Column(
        Integer,
        ForeignKey("caregivers.id"),
        nullable=True,
        unique=True,
    )

    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
