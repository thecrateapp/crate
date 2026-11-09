import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest

from export_music_path_fixture import PIN, build_fixture, main

class MusicPathExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = build_fixture()

    def test_pinned_cases_reproduce_anchor_and_sparse_regressions(self):
        cases = {c['id']: c for c in self.fixture['cases']}
        self.assertEqual(cases['complete']['resultIds'], [1, 3, 4, 5, 2])
        self.assertEqual(cases['family']['resultIds'], [1, 4, 2])
        self.assertEqual(cases['sparse']['resultIds'], [1, 2])
        self.assertEqual(cases['sparse']['requested'], 20)
        self.assertEqual(len(cases['sparse']['attempts']), 18)
        self.assertEqual(self.fixture['source']['commit'], PIN)
        self.assertTrue(all(len(v) == 64 for v in self.fixture['source']['sha256'].values()))

    def test_destination_is_excluded_before_first_fetch_and_live_variant_is_not_selected(self):
        for case in self.fixture['cases']:
            first = case['attempts'][0]
            self.assertIn(2, first['excludedIds'])
            self.assertNotIn(2, first['retrievedIds'])
        family = next(c for c in self.fixture['cases'] if c['id'] == 'family')
        self.assertIn(3, family['attempts'][0]['retrievedIds'])
        self.assertNotIn(3, family['resultIds'])
        self.assertIn(3, family['attempts'][0]['familyExcludedIds'])
        sparse = next(c for c in self.fixture['cases'] if c['id'] == 'sparse')
        self.assertEqual(next(e for e in sparse['events'] if e['kind']=='exhausted')['attemptCount'], 18)

    def test_export_is_deterministic_and_check_detects_drift_without_writing(self):
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
