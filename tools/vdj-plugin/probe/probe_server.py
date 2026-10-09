"""Local media server for the VH01 VirtualDJ host probe.

Serves generated WAV files on 127.0.0.1 with HEAD and Range support, rejects
expired tickets and logs every request as one JSON line.
"""

from __future__ import annotations

import argparse
import json
import math
import struct
import threading
import time
import wave
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

DEFAULT_DIRECTORY = Path.home() / "Library/Application Support/VirtualDJ/CrateProbe"
SAMPLE_RATE = 44_100
MEDIA_FILES = {
    "probe-short.wav": 30,
    "probe-long-throttled.wav": 360,
    "probe-local.wav": 30,
}
CHUNK_BYTES = 64 * 1024


def write_click_track(path: Path, seconds: int) -> None:
    beat_frames = SAMPLE_RATE // 2
    click_frames = SAMPLE_RATE // 100
    beat = bytearray()
    for index in range(beat_frames):
        tone = 0.2 * math.sin(2.0 * math.pi * 220.0 * index / SAMPLE_RATE)
        click = 0.6 if index < click_frames else 0.0
        value = int(max(-1.0, min(1.0, tone + click)) * 32_767)
        beat += struct.pack("<hh", value, value)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(bytes(beat) * (seconds * 2))


def prepare_media(directory: Path, files: dict[str, int] = MEDIA_FILES) -> Path:
    media = directory / "media"
    media.mkdir(parents=True, exist_ok=True)
    for name, seconds in files.items():
        target = media / name
        if not target.exists():
            write_click_track(target, seconds)
    return media


def parse_range(header: str | None, size: int) -> tuple[int, int] | None | str:
    if not header:
        return None
    if not header.startswith("bytes=") or "," in header:
        return "invalid"
    start_text, _, end_text = header[len("bytes=") :].partition("-")
    try:
        if start_text == "":
            length = int(end_text)
            if length <= 0:
                return "invalid"
            return max(0, size - length), size - 1
        start = int(start_text)
        end = int(end_text) if end_text else size - 1
    except ValueError:
        return "invalid"
    if start >= size or start > end:
        return "invalid"
    return start, min(end, size - 1)


class ProbeServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(
        self,
        port: int,
        directory: Path,
        ticket_ttl_seconds: int,
        throttle_kbps: int,
        media_files: dict[str, int] = MEDIA_FILES,
    ) -> None:
        super().__init__(("127.0.0.1", port), ProbeRequestHandler)
        self.media = prepare_media(directory, media_files)
        self.log_path = directory / "server.jsonl"
        self.ticket_ttl_seconds = ticket_ttl_seconds
        self.throttle_kbps = throttle_kbps
        self.log_lock = threading.Lock()

    def log_request_event(self, payload: dict) -> None:
        line = json.dumps({"epoch_ms": int(time.time() * 1000), **payload})
        with self.log_lock, self.log_path.open("a") as output:
            output.write(line + "\n")


class ProbeRequestHandler(BaseHTTPRequestHandler):
    server: ProbeServer

    def do_HEAD(self) -> None:
        self._serve(send_body=False)

    def do_GET(self) -> None:
        self._serve(send_body=True)

    def log_message(self, format: str, *args) -> None:
        return

    def _serve(self, *, send_body: bool) -> None:
        url = urlparse(self.path)
        range_header = self.headers.get("Range")
        event = {
            "method": self.command,
            "path": url.path,
            "range": range_header,
            "user_agent": self.headers.get("User-Agent"),
        }
        status, start, end, size, ticket_age = self._authorize(url)
        if status is None:
            target = self.server.media / Path(url.path).name
            size = target.stat().st_size
            parsed = parse_range(range_header, size)
            if parsed == "invalid":
                status = HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE
            elif parsed is None:
                status, start, end = HTTPStatus.OK, 0, size - 1
            else:
                status = HTTPStatus.PARTIAL_CONTENT
                start, end = parsed
        sent = 0
        try:
            sent = self._respond(status, start, end, size, send_body)
        except (BrokenPipeError, ConnectionResetError):
            event["aborted"] = True
        finally:
            self.server.log_request_event(
                {
                    **event,
                    "status": int(status),
                    "bytes_sent": sent,
                    "ticket_age_s": ticket_age,
                }
            )

    def _authorize(self, url) -> tuple[HTTPStatus | None, int, int, int, float | None]:
        if not url.path.startswith("/media/"):
            return HTTPStatus.NOT_FOUND, 0, 0, 0, None
        target = self.server.media / Path(url.path).name
        if not target.is_file():
            return HTTPStatus.NOT_FOUND, 0, 0, 0, None
        ticket = parse_qs(url.query).get("ticket", [""])[0]
        try:
            issued_at = float(ticket)
        except ValueError:
            return HTTPStatus.UNAUTHORIZED, 0, 0, 0, None
        age = round(time.time() - issued_at, 3)
        if age > self.server.ticket_ttl_seconds:
            return HTTPStatus.UNAUTHORIZED, 0, 0, 0, age
        return None, 0, 0, 0, age

    def _respond(
        self,
        status: HTTPStatus,
        start: int,
        end: int,
        size: int,
        send_body: bool,
    ) -> int:
        if status not in (HTTPStatus.OK, HTTPStatus.PARTIAL_CONTENT):
            self.send_response(status)
            if status == HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE:
                self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return 0
        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if not send_body:
            return 0
        target = self.server.media / Path(urlparse(self.path).path).name
        throttled = "throttled" in target.name and self.server.throttle_kbps > 0
        sent = 0
        with target.open("rb") as source:
            source.seek(start)
            while sent < length:
                chunk = source.read(min(CHUNK_BYTES, length - sent))
                if not chunk:
                    break
                self.wfile.write(chunk)
                sent += len(chunk)
                if throttled:
                    time.sleep(len(chunk) / (self.server.throttle_kbps * 1024))
        return sent


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIRECTORY)
    parser.add_argument("--ticket-ttl", type=int, default=20)
    parser.add_argument("--throttle-kbps", type=int, default=1500)
    args = parser.parse_args()
    server = ProbeServer(args.port, args.dir, args.ticket_ttl, args.throttle_kbps)
    print(
        f"Crate probe server on http://127.0.0.1:{args.port} "
        f"(ticket TTL {args.ticket_ttl}s, log {server.log_path})"
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
