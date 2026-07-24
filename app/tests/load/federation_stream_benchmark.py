#!/usr/bin/env python3
"""Reproducible loopback benchmark for Crate's federation stream data plane."""

from __future__ import annotations

import argparse
import asyncio
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import resource
import socket
import statistics
import subprocess
import tempfile
import threading
import time

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
import httpx
import uvicorn

from crate.federation.signing import sign_request, verify_signature


CHUNK_SIZE = 64 * 1024
BENCHMARK_TICKET_UID = "11111111-1111-4111-8111-111111111111"
BENCHMARK_SERVICE_TOKEN = "benchmark-readplane-service-token-32-bytes"


@dataclass(frozen=True, slots=True)
class CaseResult:
    name: str
    concurrency: int
    requests: int
    bytes_received: int
    errors: int
    ttfb_p50_ms: float
    ttfb_p95_ms: float
    ttfb_p99_ms: float
    throughput_mib_s: float


def aggregate_case_results(name: str, samples: list[CaseResult]) -> CaseResult:
    if not samples:
        raise ValueError("at least one benchmark sample is required")
    first = samples[0]
    if any(sample.concurrency != first.concurrency for sample in samples):
        raise ValueError("benchmark samples must use the same concurrency")
    return CaseResult(
        name=name,
        concurrency=first.concurrency,
        requests=sum(sample.requests for sample in samples),
        bytes_received=sum(sample.bytes_received for sample in samples),
        errors=sum(sample.errors for sample in samples),
        ttfb_p50_ms=round(
            statistics.median(sample.ttfb_p50_ms for sample in samples), 3
        ),
        ttfb_p95_ms=round(
            statistics.median(sample.ttfb_p95_ms for sample in samples), 3
        ),
        ttfb_p99_ms=round(
            statistics.median(sample.ttfb_p99_ms for sample in samples), 3
        ),
        throughput_mib_s=round(
            statistics.median(sample.throughput_mib_s for sample in samples), 2
        ),
    )


def percentile(values: list[float], quantile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(max(int(len(ordered) * quantile + 0.999999) - 1, 0), len(ordered) - 1)
    return round(ordered[index], 3)


def evaluate_gate(report: dict) -> dict[str, object]:
    remote = report["cases"]["remote_full_25"]
    direct = report["cases"]["direct_full_25"]
    overhead = 1 - (remote["throughput_mib_s"] / max(direct["throughput_mib_s"], 0.001))
    checks = {
        "remote_ttfb_p95_ms": remote["ttfb_p95_ms"] <= 1500,
        "throughput_overhead_percent": overhead * 100 <= 15,
        "event_loop_lag_p95_ms": report["event_loop_lag_p95_ms"] < 100,
        "metadata_p95_ms": report["metadata_under_load_p95_ms"] <= 500,
        "errors": remote["errors"] == 0,
        "range_and_disconnect": report["range_ok"] and report["disconnect_ok"],
    }
    return {
        "passed": all(checks.values()),
        "checks": checks,
        "throughput_overhead_percent": round(overhead * 100, 2),
    }


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _start_server(app: FastAPI, port: int) -> uvicorn.Server:
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                return server
        except OSError:
            time.sleep(0.02)
    raise RuntimeError(f"benchmark server on {port} did not start")


def _signed_headers(private_key, url: str, *, range_header: str | None = None):
    parsed = httpx.URL(url)
    headers = sign_request(
        private_key=private_key,
        method="GET",
        path_with_query=parsed.raw_path.decode(),
        host=parsed.netloc.decode(),
        content_type="",
        node_id="11111111-1111-4111-8111-111111111111",
        key_id="benchmark-key",
        body=b"",
    )
    if range_header:
        headers["Range"] = range_header
    return headers


def _apps(
    file_path: Path, origin_url: str, private_key, public_key, loop_lag: list[float]
):
    origin = FastAPI()

    @origin.get("/audio")
    def audio(request: Request):
        headers = request.headers
        signature = headers.get("x-crate-signature", "").removeprefix("ed25519:")
        try:
            timestamp = int(headers.get("x-crate-timestamp", "0"))
        except ValueError as exc:
            raise HTTPException(status_code=401) from exc
        if not verify_signature(
            public_key=public_key,
            method="GET",
            path_with_query=request.url.path,
            host=headers.get("host", ""),
            content_type="",
            node_id=headers.get("x-crate-node-id", ""),
            key_id=headers.get("x-crate-key-id", ""),
            timestamp=timestamp,
            nonce=headers.get("x-crate-nonce", ""),
            body=b"",
            signature_b64=signature,
        ):
            raise HTTPException(status_code=401)
        return FileResponse(file_path, media_type="audio/flac")

    stop = asyncio.Event()

    @asynccontextmanager
    async def lifespan(_app):
        async def sampler():
            expected = time.monotonic()
            while not stop.is_set():
                expected += 0.01
                await asyncio.sleep(max(expected - time.monotonic(), 0))
                loop_lag.append(max((time.monotonic() - expected) * 1000, 0))

        task = asyncio.create_task(sampler())
        yield
        stop.set()
        await task

    proxy = FastAPI(lifespan=lifespan)

    @proxy.get("/local")
    def local():
        return FileResponse(file_path, media_type="audio/flac")

    @proxy.get("/metadata")
    async def metadata():
        return JSONResponse({"ok": True})

    @proxy.post("/internal/federation/streams/authorize")
    async def authorize(request: Request):
        if request.headers.get("x-crate-service-token") != BENCHMARK_SERVICE_TOKEN:
            raise HTTPException(status_code=401)
        body = await request.json()
        if (
            body.get("ticket_uid") != BENCHMARK_TICKET_UID
            or body.get("method") != "GET"
            or body.get("audience") != "crate-readplane"
            or body.get("request_path") != "/remote"
        ):
            raise HTTPException(status_code=410)
        signed_headers = _signed_headers(
            private_key,
            f"{origin_url}/audio",
            range_header=body.get("range"),
        )
        if body.get("if_range"):
            signed_headers["If-Range"] = body["if_range"]
        if body.get("accept"):
            signed_headers["Accept"] = body["accept"]
        return {
            "authorization_uid": "22222222-2222-4222-8222-222222222222",
            "ticket_uid": BENCHMARK_TICKET_UID,
            "remote_node_uid": "33333333-3333-4333-8333-333333333333",
            "audience": "crate-readplane",
            "method": "GET",
            "request_path": "/remote",
            "external_url": f"{origin_url}/audio",
            "connection_url": f"{origin_url}/audio",
            "host_header": f"127.0.0.1:{httpx.URL(origin_url).port}",
            "sni_hostname": "127.0.0.1",
            "signed_headers": signed_headers,
            "expires_at": (
                datetime.now(timezone.utc) + timedelta(seconds=15)
            ).isoformat(),
        }

    @proxy.get("/remote")
    def remote(request: Request):
        range_header = request.headers.get("range")
        client = httpx.Client(timeout=30)
        context = client.stream(
            "GET",
            f"{origin_url}/audio",
            headers=_signed_headers(
                private_key, f"{origin_url}/audio", range_header=range_header
            ),
        )
        upstream = context.__enter__()
        if upstream.status_code >= 400:
            context.__exit__(None, None, None)
            client.close()
            raise HTTPException(status_code=upstream.status_code)

        def body():
            try:
                yield from upstream.iter_bytes(chunk_size=CHUNK_SIZE)
            finally:
                context.__exit__(None, None, None)
                client.close()

        safe_headers = {
            key: value
            for key, value in upstream.headers.items()
            if key.lower() in {"content-length", "content-range", "accept-ranges"}
        }
        return StreamingResponse(
            body(),
            status_code=upstream.status_code,
            media_type=upstream.headers.get("content-type"),
            headers=safe_headers,
        )

    return origin, proxy


async def _request(client: httpx.AsyncClient, url: str, headers: dict | None = None):
    started = time.perf_counter()
    total = 0
    first = None
    status = 0
    try:
        async with client.stream("GET", url, headers=headers) as response:
            status = response.status_code
            async for chunk in response.aiter_bytes(CHUNK_SIZE):
                if first is None:
                    first = time.perf_counter()
                total += len(chunk)
        return ((first or time.perf_counter()) - started) * 1000, total, status >= 400
    except Exception:
        return (time.perf_counter() - started) * 1000, total, True


async def _case(name: str, url: str, concurrency: int, headers: dict | None = None):
    limits = httpx.Limits(
        max_connections=max(concurrency, 10),
        max_keepalive_connections=max(concurrency, 10),
    )
    async with httpx.AsyncClient(timeout=60, limits=limits) as client:
        started = time.perf_counter()
        values = await asyncio.gather(
            *[_request(client, url, headers=headers) for _ in range(concurrency)]
        )
        elapsed = max(time.perf_counter() - started, 0.000001)
    ttfb = [value[0] for value in values]
    received = sum(value[1] for value in values)
    return CaseResult(
        name=name,
        concurrency=concurrency,
        requests=concurrency,
        bytes_received=received,
        errors=sum(1 for value in values if value[2]),
        ttfb_p50_ms=percentile(ttfb, 0.50),
        ttfb_p95_ms=percentile(ttfb, 0.95),
        ttfb_p99_ms=percentile(ttfb, 0.99),
        throughput_mib_s=round(received / 1024 / 1024 / elapsed, 2),
    )


async def _metadata_under_load(remote_url: str, metadata_url: str):
    async with httpx.AsyncClient(timeout=60) as client:
        downloads = [
            asyncio.create_task(_request(client, f"{remote_url}/remote"))
            for _ in range(25)
        ]
        await asyncio.sleep(0.02)
        latencies = []
        for _ in range(25):
            start = time.perf_counter()
            response = await client.get(f"{metadata_url}/metadata")
            response.raise_for_status()
            latencies.append((time.perf_counter() - start) * 1000)
        await asyncio.gather(*downloads)
    return percentile(latencies, 0.95)


def _start_go_proxy(binary: str, port: int, control_plane_url: str) -> subprocess.Popen:
    process = subprocess.Popen(
        [binary],
        env={
            **os.environ,
            "BENCHMARK_ADDR": f"127.0.0.1:{port}",
            "BENCHMARK_CONTROL_PLANE": control_plane_url,
            "BENCHMARK_SERVICE_TOKEN": BENCHMARK_SERVICE_TOKEN,
        },
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stderr = process.stderr.read() if process.stderr else ""
            raise RuntimeError(f"Go benchmark proxy exited early: {stderr}")
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                return process
        except OSError:
            time.sleep(0.02)
    process.terminate()
    raise RuntimeError("Go benchmark proxy did not start")


async def _run(
    file_mib: int,
    concurrencies: list[int],
    go_proxy_binary: str | None,
    measurement_rounds: int,
) -> dict:
    with tempfile.TemporaryDirectory(prefix="crate-stream-benchmark-") as directory:
        file_path = Path(directory) / "reference.flac"
        with file_path.open("wb") as handle:
            handle.truncate(file_mib * 1024 * 1024)
        private_key = Ed25519PrivateKey.generate()
        loop_lag: list[float] = []
        origin_port = _free_port()
        proxy_port = _free_port()
        go_proxy_port = _free_port()
        origin_url = f"http://127.0.0.1:{origin_port}"
        proxy_url = f"http://127.0.0.1:{proxy_port}"
        origin, proxy = _apps(
            file_path, origin_url, private_key, private_key.public_key(), loop_lag
        )
        origin_server = _start_server(origin, origin_port)
        proxy_server = _start_server(proxy, proxy_port)
        go_proxy_process = None
        data_plane = "fastapi"
        data_plane_url = proxy_url
        if go_proxy_binary:
            go_proxy_process = _start_go_proxy(
                go_proxy_binary, go_proxy_port, proxy_url
            )
            data_plane = "go-readplane"
            data_plane_url = f"http://127.0.0.1:{go_proxy_port}"
        cases: dict[str, dict] = {}
        process_cpu_start = time.process_time()
        try:
            direct_url = f"{origin_url}/audio"
            remote_url = f"{data_plane_url}/remote"
            await _case(
                "direct_warmup",
                direct_url,
                1,
                _signed_headers(private_key, direct_url),
            )
            await _case("remote_warmup", remote_url, 1)

            async def measure_direct(concurrency: int) -> CaseResult:
                return await _case(
                    f"direct_full_{concurrency}",
                    direct_url,
                    concurrency,
                    _signed_headers(private_key, direct_url),
                )

            async def measure_remote(concurrency: int) -> CaseResult:
                return await _case(
                    f"remote_full_{concurrency}", remote_url, concurrency
                )

            for concurrency in concurrencies:
                direct_samples: list[CaseResult] = []
                remote_samples: list[CaseResult] = []
                for round_index in range(measurement_rounds):
                    if round_index % 2 == 0:
                        direct_samples.append(await measure_direct(concurrency))
                        remote_samples.append(await measure_remote(concurrency))
                    else:
                        remote_samples.append(await measure_remote(concurrency))
                        direct_samples.append(await measure_direct(concurrency))
                direct = aggregate_case_results(
                    f"direct_full_{concurrency}", direct_samples
                )
                remote = aggregate_case_results(
                    f"remote_full_{concurrency}", remote_samples
                )
                cases[direct.name] = asdict(direct)
                cases[remote.name] = asdict(remote)
            local = await _case("local_full_1", f"{proxy_url}/local", 1)
            small_range = await _case(
                "remote_range_64k",
                f"{data_plane_url}/remote",
                10,
                {"Range": "bytes=1048576-1114111"},
            )
            cases[local.name] = asdict(local)
            cases[small_range.name] = asdict(small_range)
            async with httpx.AsyncClient(timeout=30) as client:
                async with client.stream("GET", f"{data_plane_url}/remote") as response:
                    iterator = response.aiter_bytes(CHUNK_SIZE)
                    await anext(iterator)
                disconnect_ok = (
                    await client.get(f"{proxy_url}/metadata")
                ).status_code == 200
            metadata_p95 = await _metadata_under_load(data_plane_url, proxy_url)
        finally:
            if go_proxy_process is not None:
                go_proxy_process.terminate()
                try:
                    go_proxy_process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    go_proxy_process.kill()
            origin_server.should_exit = True
            proxy_server.should_exit = True
            await asyncio.sleep(0.2)
        report = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "platform": os.uname().sysname + " " + os.uname().machine,
            "data_plane": data_plane,
            "file_mib": file_mib,
            "measurement_rounds": measurement_rounds,
            "chunk_size": CHUNK_SIZE,
            "cases": cases,
            "range_ok": small_range.errors == 0
            and small_range.bytes_received == 10 * 65536,
            "disconnect_ok": disconnect_ok,
            "event_loop_lag_p95_ms": percentile(loop_lag, 0.95),
            "metadata_under_load_p95_ms": metadata_p95,
            "process_cpu_seconds": round(time.process_time() - process_cpu_start, 3),
            "max_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        }
        report["gate"] = evaluate_gate(report)
        return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file-mib", type=int, default=8)
    parser.add_argument("--concurrency", default="1,10,25,50")
    parser.add_argument("--measurement-rounds", type=int, default=3)
    parser.add_argument("--output")
    parser.add_argument("--go-proxy-binary")
    args = parser.parse_args()
    concurrencies = sorted({int(value) for value in args.concurrency.split(",")})
    if 25 not in concurrencies:
        concurrencies.append(25)
        concurrencies.sort()
    report = asyncio.run(
        _run(
            max(args.file_mib, 1),
            concurrencies,
            args.go_proxy_binary,
            max(args.measurement_rounds, 1),
        )
    )
    payload = json.dumps(report, indent=2, sort_keys=True)
    print(payload)
    if args.output:
        Path(args.output).write_text(payload + "\n")
    return 0 if report["gate"]["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
