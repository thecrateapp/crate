//! Process-wide Prometheus metrics, served from their own listener thread so a
//! scrape never waits behind a package on the sequential job socket.

use std::fmt::Write as _;
use std::io::{self, BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};

const ROUTES: [&str; 4] = ["healthz", "album", "track", "unmatched"];
const STATUS_CLASSES: [&str; 5] = ["2xx", "3xx", "4xx", "5xx", "other"];
const KINDS: [&str; 2] = ["album", "track"];
const OUTCOMES: [&str; 2] = ["ok", "failed"];
const DURATION_BUCKETS: [f64; 10] = [0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 300.0, 900.0];

struct Histogram {
    buckets: [AtomicU64; DURATION_BUCKETS.len()],
    count: AtomicU64,
    sum_micros: AtomicU64,
}

impl Histogram {
    const fn new() -> Self {
        Self {
            buckets: [const { AtomicU64::new(0) }; DURATION_BUCKETS.len()],
            count: AtomicU64::new(0),
            sum_micros: AtomicU64::new(0),
        }
    }

    fn observe(&self, seconds: f64) {
        for (bucket, bound) in self.buckets.iter().zip(DURATION_BUCKETS) {
            if seconds <= bound {
                bucket.fetch_add(1, Ordering::Relaxed);
            }
        }
        self.count.fetch_add(1, Ordering::Relaxed);
        self.sum_micros
            .fetch_add((seconds * 1_000_000.0) as u64, Ordering::Relaxed);
    }
}

struct Metrics {
    requests: [[AtomicU64; STATUS_CLASSES.len()]; ROUTES.len()],
    in_progress: AtomicI64,
    packages: [[AtomicU64; OUTCOMES.len()]; KINDS.len()],
    durations: [Histogram; KINDS.len()],
}

static METRICS: Metrics = Metrics {
    requests: [const { [const { AtomicU64::new(0) }; STATUS_CLASSES.len()] }; ROUTES.len()],
    in_progress: AtomicI64::new(0),
    packages: [const { [const { AtomicU64::new(0) }; OUTCOMES.len()] }; KINDS.len()],
    durations: [const { Histogram::new() }; KINDS.len()],
};

pub fn route_label(path: &str) -> &'static str {
    match path {
        "/healthz" => "healthz",
        "/v1/packages/album" => "album",
        "/v1/packages/track" => "track",
        _ => "unmatched",
    }
}

pub fn status_class(status: u16) -> &'static str {
    match status {
        200..=299 => "2xx",
        300..=399 => "3xx",
        400..=499 => "4xx",
        500..=599 => "5xx",
        _ => "other",
    }
}

fn index(values: &[&str], value: &str) -> usize {
    values
        .iter()
        .position(|item| *item == value)
        .unwrap_or(values.len() - 1)
}

pub fn record_request(path: &str, status: u16) {
    METRICS.requests[index(&ROUTES, route_label(path))]
        [index(&STATUS_CLASSES, status_class(status))]
    .fetch_add(1, Ordering::Relaxed);
}

pub struct PackageTimer {
    kind: usize,
    started: Instant,
    finished: bool,
}

pub fn start_package(kind: &str) -> PackageTimer {
    METRICS.in_progress.fetch_add(1, Ordering::Relaxed);
    PackageTimer {
        kind: index(&KINDS, kind),
        started: Instant::now(),
        finished: false,
    }
}

impl PackageTimer {
    pub fn finish(mut self, ok: bool) {
        self.complete(ok);
    }

    fn complete(&mut self, ok: bool) {
        if self.finished {
            return;
        }
        self.finished = true;
        METRICS.in_progress.fetch_sub(1, Ordering::Relaxed);
        METRICS.packages[self.kind][usize::from(!ok)].fetch_add(1, Ordering::Relaxed);
        METRICS.durations[self.kind].observe(self.started.elapsed().as_secs_f64());
    }
}

impl Drop for PackageTimer {
    fn drop(&mut self) {
        self.complete(false);
    }
}

pub fn render() -> String {
    let mut out = String::new();
    let _ = writeln!(
        out,
        "# HELP crate_media_worker_requests_total Media worker responses by route and status class\n# TYPE crate_media_worker_requests_total counter"
    );
    for (route, row) in ROUTES.iter().zip(&METRICS.requests) {
        for (class, count) in STATUS_CLASSES.iter().zip(row) {
            let value = count.load(Ordering::Relaxed);
            if value > 0 {
                let _ = writeln!(
                    out,
                    "crate_media_worker_requests_total{{route=\"{route}\",status_class=\"{class}\"}} {value}"
                );
            }
        }
    }
    let _ = writeln!(
        out,
        "# HELP crate_media_worker_packages_in_progress Packages being built now\n# TYPE crate_media_worker_packages_in_progress gauge\ncrate_media_worker_packages_in_progress {}",
        METRICS.in_progress.load(Ordering::Relaxed)
    );
    let _ = writeln!(
        out,
        "# HELP crate_media_worker_packages_total Finished packages by kind and outcome\n# TYPE crate_media_worker_packages_total counter"
    );
    for (kind, row) in KINDS.iter().zip(&METRICS.packages) {
        for (outcome, count) in OUTCOMES.iter().zip(row) {
            let _ = writeln!(
                out,
                "crate_media_worker_packages_total{{kind=\"{kind}\",outcome=\"{outcome}\"}} {}",
                count.load(Ordering::Relaxed)
            );
        }
    }
    let _ = writeln!(
        out,
        "# HELP crate_media_worker_package_duration_seconds Time to build a package\n# TYPE crate_media_worker_package_duration_seconds histogram"
    );
    for (kind, histogram) in KINDS.iter().zip(&METRICS.durations) {
        for (bound, bucket) in DURATION_BUCKETS.iter().zip(&histogram.buckets) {
            let _ = writeln!(
                out,
                "crate_media_worker_package_duration_seconds_bucket{{kind=\"{kind}\",le=\"{bound}\"}} {}",
                bucket.load(Ordering::Relaxed)
            );
        }
        let count = histogram.count.load(Ordering::Relaxed);
        let sum = histogram.sum_micros.load(Ordering::Relaxed) as f64 / 1_000_000.0;
        let _ = writeln!(
            out,
            "crate_media_worker_package_duration_seconds_bucket{{kind=\"{kind}\",le=\"+Inf\"}} {count}\ncrate_media_worker_package_duration_seconds_sum{{kind=\"{kind}\"}} {sum}\ncrate_media_worker_package_duration_seconds_count{{kind=\"{kind}\"}} {count}"
        );
    }
    out
}

pub fn serve(addr: &str) -> io::Result<SocketAddr> {
    let listener = TcpListener::bind(addr)?;
    let local = listener.local_addr()?;
    thread::Builder::new()
        .name("metrics".to_string())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                let _ = respond(stream);
            }
        })?;
    Ok(local)
}

fn respond(mut stream: TcpStream) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let mut request_line = String::new();
    BufReader::new(&stream).read_line(&mut request_line)?;
    let mut parts = request_line.split_whitespace();
    let (status, body) = match (parts.next(), parts.next()) {
        (Some("GET"), Some("/metrics")) => ("200 OK", render()),
        _ => ("404 Not Found", String::new()),
    };
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; version=0.0.4; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::sync::mpsc;

    fn scrape(addr: SocketAddr, path: &str) -> String {
        let mut stream = TcpStream::connect(addr).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        write!(stream, "GET {path} HTTP/1.1\r\nHost: test\r\n\r\n").unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }

    fn sample(text: &str, series: &str) -> f64 {
        text.lines()
            .find_map(|line| line.strip_prefix(series)?.strip_prefix(' ')?.parse().ok())
            .unwrap_or(0.0)
    }

    #[test]
    fn observability_labels_are_bounded() {
        for (path, label) in [
            ("/healthz", "healthz"),
            ("/v1/packages/album", "album"),
            ("/v1/packages/track", "track"),
            ("/v1/packages/album/../x", "unmatched"),
        ] {
            assert_eq!(route_label(path), label);
        }
        for (status, class) in [(200, "2xx"), (404, "4xx"), (503, "5xx"), (99, "other")] {
            assert_eq!(status_class(status), class);
        }
    }

    #[test]
    fn observability_scrape_answers_while_a_package_is_still_building() {
        let addr = serve("127.0.0.1:0").unwrap();
        let before = render();
        let (started, wait_started) = mpsc::channel();
        let (release, wait_release) = mpsc::channel::<()>();
        let worker = thread::spawn(move || {
            let timer = start_package("album");
            started.send(()).unwrap();
            wait_release.recv().unwrap();
            timer.finish(true);
        });
        wait_started.recv().unwrap();

        let busy = scrape(addr, "/metrics");
        release.send(()).unwrap();
        worker.join().unwrap();
        let after = scrape(addr, "/metrics");

        assert!(busy.starts_with("HTTP/1.1 200 OK"));
        assert!(sample(&busy, "crate_media_worker_packages_in_progress") >= 1.0);
        for series in [
            "crate_media_worker_packages_total{kind=\"album\",outcome=\"ok\"}",
            "crate_media_worker_package_duration_seconds_count{kind=\"album\"}",
            "crate_media_worker_package_duration_seconds_bucket{kind=\"album\",le=\"+Inf\"}",
        ] {
            assert!(
                sample(&after, series) >= sample(&before, series) + 1.0,
                "{series}"
            );
        }
        assert!(scrape(addr, "/healthz").starts_with("HTTP/1.1 404"));
    }

    #[test]
    fn observability_dropped_timer_counts_as_failed_and_requests_are_counted() {
        let failed = "crate_media_worker_packages_total{kind=\"track\",outcome=\"failed\"}";
        let health = "crate_media_worker_requests_total{route=\"healthz\",status_class=\"2xx\"}";
        let unmatched =
            "crate_media_worker_requests_total{route=\"unmatched\",status_class=\"4xx\"}";
        let before = render();

        drop(start_package("track"));
        record_request("/healthz", 200);
        record_request("/nope", 404);

        let after = render();
        for series in [failed, health, unmatched] {
            assert!(
                sample(&after, series) >= sample(&before, series) + 1.0,
                "{series}"
            );
        }
    }
}
