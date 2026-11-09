import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest

from export_radio_fixture import PIN, build_fixture, main


class RadioExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = build_fixture()
        cls.cases = {case['id']: case for case in cls.fixture['cases']}

    def test_skip_changes_delivery_memory_without_inventing_significant_history(self):
        case = self.cases['skip']
        play = next(e for e in case['events'] if e['kind'] == 'play')
        self.assertEqual(play['play'], {'seconds': 5, 'duration': 180, 'threshold': 30, 'significant': False})
        self.assertEqual(play['historyKeys'], [])
        self.assertEqual(play['deliveredKeys'], [['a', 'delivered x']])
        choices = [e for e in case['events'] if e['kind'] == 'choose']
        self.assertEqual([e['selectedId'] for e in choices], [1, 2])
        self.assertEqual(choices[-1]['originalWinnerId'], 1)
        self.assertEqual(choices[-1]['reason'], 'delivery')
        self.assertEqual([r['score'] for r in choices[-1]['candidates']], [0.1, 0.4, 1.0])

    def test_buffer_is_hard_but_significant_listening_rotates_within_the_band(self):
        events = self.cases['listen']['events']
        first = events[0]
        statuses = {r['id']: r['status'] for r in first['candidates']}
        self.assertEqual(statuses[1], 'In buffer')
        self.assertEqual(statuses[2], 'Buffered song family')
        self.assertIsNone(next(r for r in first['candidates'] if r['id'] == 1)['score'])
        play = next(e for e in events if e['kind'] == 'play')
        self.assertTrue(play['play']['significant'])
        new_session = next(e for e in events if e['kind'] == 'new-session')
        self.assertEqual(new_session['deliveredKeys'], [])
        self.assertEqual(new_session['bufferIds'], [])
        self.assertEqual(new_session['historyKeys'], [['a', 'song']])
        choice = next(e for e in events if e['kind'] == 'choose')
        self.assertEqual(choice['reason'], 'history')
        self.assertEqual(choice['selectedId'], 3)
        self.assertAlmostEqual(choice['qualityLimit'], 0.15)
        self.assertEqual(next(r for r in choice['candidates'] if r['id'] == 2)['key'], ['a', 'song'])

    def test_display_order_is_eligible_rank_then_hard_exclusions(self):
        for case in self.fixture['cases']:
            for event in case['events']:
                scores = [r['score'] for r in event['candidates']]
                expected = sorted(scores, key=lambda score: float('inf') if score is None else score)
                self.assertEqual(scores, expected)

    def test_fallbacks_preserve_quality_and_recover_only_when_the_buffer_is_empty(self):
        quality = next(e for e in self.cases['quality']['events'] if e['kind'] == 'choose')
        self.assertEqual((quality['selectedId'], quality['reason']), (1, 'quality-fallback'))
        limited = [e for e in self.cases['limited']['events'] if e['kind'] == 'choose'][-1]
        self.assertEqual((limited['selectedId'], limited['reason']), (1, 'delivery-fallback'))
        self.assertEqual(limited['bufferIds'], [])
        # Scores are normalized within the current pool. One eligible row scores 1.0.
        self.assertEqual(limited['candidates'][0]['score'], 1.0)
        self.assertEqual(self.fixture['source']['commit'], PIN)
        self.assertTrue(all(len(v) == 64 for v in self.fixture['source']['sha256'].values()))

    def test_deterministic_export_and_nonmutating_drift_check(self):
        self.assertEqual(self.fixture, build_fixture())
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            path = Path(directory) / 'fixture.json'
            self.assertEqual(main(['--output', str(path)]), 0)
            self.assertEqual(json.loads(path.read_text()), self.fixture)
            self.assertEqual(main(['--check', '--output', str(path)]), 0)
            path.write_text('{}\n')
            self.assertEqual(main(['--check', '--output', str(path)]), 1)
            self.assertEqual(path.read_text(), '{}\n')


if __name__ == '__main__':
    unittest.main()
