"""Completed New York calendar windows using frozen TZif bytes."""
import datetime as dt
import hashlib
import io
from zoneinfo import ZoneInfo

def completed_window(period, now, timezone_bytes):
    if period not in ('daily', 'weekly') or now.tzinfo is None:
        raise ValueError('invalid_scheduled_window_request')
    zone = ZoneInfo.from_file(io.BytesIO(timezone_bytes), key='America/New_York')
    today = now.astimezone(zone).date()
    end_date = today if period == 'daily' else today - dt.timedelta(days=today.weekday())
    start_date = end_date - dt.timedelta(days=1 if period == 'daily' else 7)
    start = dt.datetime.combine(start_date, dt.time(), zone)
    end = dt.datetime.combine(end_date, dt.time(), zone)
    utc = lambda value: value.astimezone(dt.timezone.utc).isoformat().replace('+00:00', 'Z')
    return {'schema_version': 1, 'period': period, 'timezone': 'America/New_York',
            'window_start': utc(start), 'window_end': utc(end),
            'local_start': start.isoformat(), 'local_end': end.isoformat(),
            'computed_at': utc(now), 'timezone_sha256': hashlib.sha256(timezone_bytes).hexdigest(),
            'window_kind': 'completed_calendar_day' if period == 'daily' else 'completed_calendar_week'}
