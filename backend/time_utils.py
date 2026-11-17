from datetime import datetime, timezone


def utcnow_naive() -> datetime:
    """Return current UTC time as a naive datetime for existing DB columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
