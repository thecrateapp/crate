import unittest

from run_windows_probe import build_probe_environment


class ProbeEnvironmentTests(unittest.TestCase):
    def test_removes_python_runtime_paths_and_variables_from_child(self) -> None:
        python_location = r"C:\hostedtoolcache\windows\Python\3.13.15\x64"
        source = {
            "PATH": ";".join(
                (
                    python_location,
                    r"C:\Program Files\PowerShell\7",
                    python_location + r"\Scripts",
                    r"C:\Windows\System32",
                )
            ),
            "pythonLocation": python_location,
            "Python_ROOT_DIR": python_location,
            "PYTHONPATH": r"C:\python-modules",
            "CRATE_HTTP_RESOURCE_PROBE_ORIGIN": "http://127.0.0.1:1234",
        }

        environment, removed_paths = build_probe_environment(
            source,
            path_separator=";",
        )

        self.assertEqual(
            environment["PATH"],
            ";".join(
                (
                    r"C:\Program Files\PowerShell\7",
                    r"C:\Windows\System32",
                )
            ),
        )
        self.assertEqual(
            removed_paths,
            [python_location, python_location + r"\Scripts"],
        )
        self.assertNotIn("pythonLocation", environment)
        self.assertNotIn("Python_ROOT_DIR", environment)
        self.assertNotIn("PYTHONPATH", environment)
        self.assertEqual(
            environment["CRATE_HTTP_RESOURCE_PROBE_ORIGIN"],
            "http://127.0.0.1:1234",
        )

    def test_keeps_path_when_python_location_is_not_configured(self) -> None:
        environment, removed_paths = build_probe_environment(
            {"PATH": "system-bin", "PYTHONPATH": "python-modules"},
            path_separator=";",
        )

        self.assertEqual(environment["PATH"], "system-bin")
        self.assertEqual(removed_paths, [])
        self.assertNotIn("PYTHONPATH", environment)


if __name__ == "__main__":
    unittest.main()
