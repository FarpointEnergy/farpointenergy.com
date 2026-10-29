import datetime as dt
import importlib.util
from pathlib import Path
import unittest
root = Path(__file__).parent
if (root / 'prepared' / 'inputs').is_dir(): root = root / 'prepared' / 'inputs'
spec = importlib.util.spec_from_file_location('scheduled_window', root / 'scheduled-window.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
tzif_path = root / 'America-New_York.tzif'
if not tzif_path.is_file(): tzif_path = Path('/usr/share/zoneinfo/America/New_York')
tzif = tzif_path.read_bytes()
class CompletedWindows(unittest.TestCase):
    def check_window(self, period, now, start, end):
        result = module.completed_window(period, dt.datetime.fromisoformat(now), tzif)
        self.assertEqual((result['window_start'], result['window_end']), (start, end))
    def test_normal_day(self):
        self.check_window('daily', '2026-10-29T12:00:00+00:00', '2026-10-28T04:00:00Z', '2026-10-29T04:00:00Z')
    def test_spring_day(self):
        self.check_window('daily', '2026-03-09T12:00:00+00:00', '2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z')
    def test_fall_day(self):
        self.check_window('daily', '2026-11-02T13:00:00+00:00', '2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z')
    def test_spring_week(self):
        self.check_window('weekly', '2026-03-09T12:30:00+00:00', '2026-03-02T05:00:00Z', '2026-03-09T04:00:00Z')
    def test_fall_week(self):
        self.check_window('weekly', '2026-11-02T13:30:00+00:00', '2026-10-26T04:00:00Z', '2026-11-02T05:00:00Z')
    def test_delayed_week(self):
        self.check_window('weekly', '2026-10-29T12:00:00+00:00', '2026-10-19T04:00:00Z', '2026-10-26T04:00:00Z')
    def test_local_date(self):
        self.check_window('daily', '2026-10-29T01:00:00+00:00', '2026-10-27T04:00:00Z', '2026-10-28T04:00:00Z')
    def test_invalid_period_and_naive_clock(self):
        for period, now in [('monthly', dt.datetime.now(dt.timezone.utc)), ('daily', dt.datetime.now())]:
            with self.assertRaises(ValueError): module.completed_window(period, now, tzif)
if __name__ == '__main__': unittest.main()
