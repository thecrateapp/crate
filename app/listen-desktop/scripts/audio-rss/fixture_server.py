"""Serve named local audio fixtures and persist probe events on loopback."""

import argparse
import json
import mimetypes
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

TRACK_NAME = re.compile(r"^[A-Za-z0-9_-]+$")
AUDIO_MIME_TYPES = {".flac": "audio/flac", ".wav": "audio/wav"}


def parse_track(value: str) -> tuple[str, Path]:
    name, separator, raw_path = value.partition("=")
    path = Path(raw_path).expanduser().resolve()
    if not separator or not TRACK_NAME.fullmatch(name):
        raise argparse.ArgumentTypeError("track must be NAME=PATH using a simple name")
    if not path.is_file():
        raise argparse.ArgumentTypeError(f"fixture is not a file: {path}")
    return name, path


def make_handler(
    tracks: dict[str, Path], report_file: Path
) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def end_headers(self) -> None:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def do_OPTIONS(self) -> None:
            self.send_response(204)
            self.end_headers()

        def do_HEAD(self) -> None:
            self.send_fixture(include_body=False)

        def do_GET(self) -> None:
            self.send_fixture(include_body=True)

        def do_POST(self) -> None:
            if urlsplit(self.path).path != "/report":
                self.send_error(404)
                return
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 1_048_576:
                self.send_error(400, "expected a JSON event under 1 MiB")
                return
            try:
                event = json.loads(self.rfile.read(size))
            except (json.JSONDecodeError, UnicodeDecodeError):
                self.send_error(400, "invalid JSON event")
                return
            with report_file.open("a", encoding="utf-8") as output:
                output.write(json.dumps(event, separators=(",", ":")) + "\n")
                output.flush()
            self.send_response(204)
            self.end_headers()

        def send_fixture(self, include_body: bool) -> None:
            name = unquote(
                urlsplit(self.path).path.removeprefix("/track/").removesuffix(".flac")
            )
            path = (
                tracks.get(name)
                if urlsplit(self.path).path.startswith("/track/")
                else None
            )
            if path is None:
                self.send_error(404, "unknown fixture")
                return
            self.send_response(200)
            content_type = AUDIO_MIME_TYPES.get(path.suffix.lower())
            if content_type is None:
                content_type = mimetypes.guess_type(path.name)[0]
            self.send_header("Content-Type", content_type or "application/octet-stream")
            self.send_header("Content-Length", str(path.stat().st_size))
            self.end_headers()
            if include_body:
                with path.open("rb") as fixture:
                    while chunk := fixture.read(1024 * 1024):
                        self.wfile.write(chunk)

        def log_message(self, format: str, *args: object) -> None:
            print(format % args, flush=True)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--track", action="append", default=[], type=parse_track, metavar="NAME=PATH"
    )
    parser.add_argument("--port", type=int, default=18765)
    parser.add_argument(
        "--report-file", type=Path, default=Path("audio-rss-events.jsonl")
    )
    args = parser.parse_args()
    tracks = dict(args.track)
    if not tracks:
        parser.error("provide at least one --track NAME=PATH")
    if len(tracks) != len(args.track):
        parser.error("track names must be unique")
    report_file = args.report_file.expanduser().resolve()
    report_file.parent.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(
        ("127.0.0.1", args.port), make_handler(tracks, report_file)
    )
    print(
        f"Serving {len(tracks)} fixture(s) on http://127.0.0.1:{args.port}", flush=True
    )
    print(f"Probe events: {report_file}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
