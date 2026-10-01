import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from run_windows_probe import (
    build_probe_environment,
    launch_probe_process,
    unexpected_probe_document,
)


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
            "CRATE_HTTP_RESOURCE_PROBE_DIAGNOSTICS": r"C:\temp\probe.txt",
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
        self.assertEqual(
            environment["CRATE_HTTP_RESOURCE_PROBE_DIAGNOSTICS"],
            r"C:\temp\probe.txt",
        )

    def test_keeps_path_when_python_location_is_not_configured(self) -> None:
        environment, removed_paths = build_probe_environment(
            {"PATH": "system-bin", "PYTHONPATH": "python-modules"},
            path_separator=";",
        )

        self.assertEqual(environment["PATH"], "system-bin")
        self.assertEqual(removed_paths, [])
        self.assertNotIn("PYTHONPATH", environment)


class ProbeProcessTests(unittest.TestCase):
    def test_does_not_capture_handles_inherited_by_webview_children(self) -> None:
        with patch("run_windows_probe.subprocess.Popen") as popen:
            launch_probe_process(Path("probe.exe"), {"PATH": "system-bin"})

        self.assertEqual(popen.call_args.kwargs["stdout"], subprocess.DEVNULL)
        self.assertEqual(popen.call_args.kwargs["stderr"], subprocess.DEVNULL)


class ProbeDocumentDiagnosticsTests(unittest.TestCase):
    def test_detects_when_the_main_app_frontend_was_loaded(self) -> None:
        diagnostics = (
            'document-state:{"title":"Crate","hasStatusElement":false}'
        )

        failure = unexpected_probe_document(diagnostics)

        self.assertEqual(
            failure,
            "probe loaded an unexpected frontend document: "
            "title='Crate', hasStatusElement=False",
        )

    def test_accepts_the_probe_frontend_document(self) -> None:
        diagnostics = (
            'document-state:{"title":"Crate HTTP resource probe",'
            '"hasStatusElement":true}'
        )

        self.assertIsNone(unexpected_probe_document(diagnostics))


if __name__ == "__main__":
    unittest.main()
