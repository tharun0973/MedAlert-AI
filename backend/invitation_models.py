from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from database import Base
from time_utils import utcnow_naive


class CaregiverInvitation(Base):
    __tablename__ = "caregiver_invitations"

    id = Column(Integer, primary_key=True, index=True)
    caregiver_id = Column(Integer, ForeignKey("caregivers.id"), nullable=False, index=True)
    token_hash = Column(String(64), unique=True, nullable=False, index=True)
    created_by_user_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=False)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
