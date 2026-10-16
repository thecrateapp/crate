"""Worker-only process deadline around the shared pinned public URL fetcher."""

import json
import resource
import subprocess
import sys
import tempfile
import time


def _unavailable(url, message):
    return {
        "available": False,
        "text": "",
        "source_ref": url,
        "truncated": False,
        "warning": message,
    }


def fetch_worker_source(url: str, *, cancelled=lambda: False, timeout=45) -> dict:
    if cancelled():
        raise ValueError("CANCELLED")
    started = time.monotonic()
    with tempfile.TemporaryFile(mode="w+b") as output:
        process = subprocess.Popen(
            [sys.executable, "-m", "crate.show_url_fetch"],
            stdin=subprocess.PIPE,
            stdout=output,
            stderr=subprocess.DEVNULL,
        )
        try:
            try:
                resource.prlimit(
                    process.pid,
                    resource.RLIMIT_AS,
                    (256 * 1024 * 1024, 256 * 1024 * 1024),
                )
                resource.prlimit(
                    process.pid, resource.RLIMIT_FSIZE, (512 * 1024, 512 * 1024)
                )
            except ProcessLookupError:
                pass
            assert process.stdin is not None
            process.stdin.write(json.dumps({"url": url}, ensure_ascii=False).encode())
            process.stdin.close()
            checked_at = 0.0
            while process.poll() is None:
                now = time.monotonic()
                if now - checked_at >= 0.5:
                    if cancelled():
                        raise ValueError("CANCELLED")
                    checked_at = now
                if now - started >= min(timeout, 45):
                    return _unavailable(
                        url,
                        "Source fetch timed out. Upload a screenshot or paste the visible text.",
                    )
                time.sleep(0.025)
            if process.returncode:
                return _unavailable(
                    url,
                    "Source could not be read. Upload a screenshot or paste the visible text.",
                )
            output.seek(0)
            data = output.read(512 * 1024 + 1)
            if len(data) > 512 * 1024:
                return _unavailable(
                    url,
                    "Source exceeded the text budget. Upload a screenshot or paste the visible text.",
                )
            result = json.loads(data)
            if not isinstance(result, dict) or not isinstance(result.get("text"), str):
                return _unavailable(url, "Source did not return readable text.")
            result.setdefault("source_ref", url)
            return result
        except (OSError, json.JSONDecodeError):
            return _unavailable(
                url,
                "Source could not be read. Upload a screenshot or paste its visible text.",
            )
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()
            if process.stdin and not process.stdin.closed:
                process.stdin.close()


def _main():
    from crate.show_extraction import fetch_show_source

    try:
        source = json.loads(sys.stdin.buffer.read(16385))
        url = source["url"]
        if not isinstance(url, str) or len(url) > 2048:
            raise ValueError("Invalid source")
        result = fetch_show_source(url)
        # The shared fetcher bounds bytes; this flag conservatively includes multi-byte truncation.
        if len(result.get("text", "").encode()) >= 60000:
            result["truncated"] = True
        sys.stdout.write(json.dumps(result))
    except Exception:
        sys.stdout.write(
            json.dumps(
                {
                    "available": False,
                    "text": "",
                    "truncated": False,
                    "warning": "Source could not be read. Upload a screenshot or paste the visible text.",
                }
            )
        )


__all__ = ["fetch_worker_source"]

if __name__ == "__main__":
    _main()
