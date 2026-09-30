use std::{
    io,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use tauri_plugin_http::reqwest::{Client, ClientBuilder};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
    task::JoinSet,
};

type BenchError = Box<dyn std::error::Error + Send + Sync>;

#[derive(Default)]
struct ServerMetrics {
    accepted: AtomicUsize,
    open: AtomicUsize,
    peak_open: AtomicUsize,
}

struct BenchmarkResult {
    cold_request: Duration,
    elapsed: Duration,
    p50: Duration,
    p95: Duration,
    accepted_connections: usize,
    peak_open_sockets: usize,
}

async fn run_server() -> io::Result<(String, Arc<ServerMetrics>)> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let metrics = Arc::new(ServerMetrics::default());
    let server_metrics = Arc::clone(&metrics);

    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            server_metrics.accepted.fetch_add(1, Ordering::Relaxed);
            let open = server_metrics.open.fetch_add(1, Ordering::Relaxed) + 1;
            server_metrics.peak_open.fetch_max(open, Ordering::Relaxed);
            let connection_metrics = Arc::clone(&server_metrics);
            tokio::spawn(async move {
                let _ = serve_connection(stream).await;
                connection_metrics.open.fetch_sub(1, Ordering::Relaxed);
            });
        }
    });

    Ok((format!("http://{address}/health"), metrics))
}

async fn serve_connection(stream: TcpStream) -> io::Result<()> {
    stream.set_nodelay(true)?;
    let mut reader = BufReader::new(stream);
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).await? == 0 {
            return Ok(());
        }
        while line != "\r\n" {
            line.clear();
            if reader.read_line(&mut line).await? == 0 {
                return Ok(());
            }
        }
        let mut response = Vec::with_capacity(16 * 1024 + 80);
        response.extend_from_slice(
            b"HTTP/1.1 200 OK\r\nContent-Length: 16384\r\nConnection: keep-alive\r\n\r\n",
        );
        response.extend_from_slice(&[b'x'; 16 * 1024]);
        reader.get_mut().write_all(&response).await?;
    }
}

async fn request(
    client: Client,
    url: &str,
) -> Result<Duration, Box<dyn std::error::Error + Send + Sync>> {
    let started = Instant::now();
    let mut response = client.get(url).send().await?.error_for_status()?;
    while response.chunk().await?.is_some() {}
    Ok(started.elapsed())
}

async fn benchmark(
    url: &str,
    metrics: &ServerMetrics,
    requests: usize,
    concurrency: usize,
    shared_client: bool,
) -> Result<BenchmarkResult, BenchError> {
    let shared = ClientBuilder::new().build()?;
    let warmup_client = if shared_client {
        shared.clone()
    } else {
        ClientBuilder::new().build()?
    };
    let cold_request = request(warmup_client, url).await?;
    if !shared_client {
        for _ in 0..100 {
            if metrics.open.load(Ordering::Relaxed) == 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    }
    metrics.accepted.store(0, Ordering::Relaxed);
    metrics
        .peak_open
        .store(metrics.open.load(Ordering::Relaxed), Ordering::Relaxed);

    let started = Instant::now();
    let mut latencies = Vec::with_capacity(requests);
    for batch_start in (0..requests).step_by(concurrency) {
        let batch_size = (requests - batch_start).min(concurrency);
        let mut tasks = JoinSet::new();
        for _ in 0..batch_size {
            let client = if shared_client {
                shared.clone()
            } else {
                ClientBuilder::new().build()?
            };
            let url = url.to_owned();
            tasks.spawn(async move { request(client, &url).await });
        }
        while let Some(result) = tasks.join_next().await {
            latencies.push(result??);
        }
    }
    let elapsed = started.elapsed();
    latencies.sort_unstable();
    let p50 = latencies[latencies.len() / 2];
    let p95 = latencies[((latencies.len() * 95).div_ceil(100) - 1).min(latencies.len() - 1)];

    Ok(BenchmarkResult {
        cold_request,
        elapsed,
        p50,
        p95,
        accepted_connections: metrics.accepted.load(Ordering::Relaxed),
        peak_open_sockets: metrics.peak_open.load(Ordering::Relaxed),
    })
}

async fn run_case(requests: usize, concurrency: usize) -> Result<(), BenchError> {
    let (url, metrics) = run_server().await?;
    let fresh = benchmark(&url, &metrics, requests, concurrency, false).await?;

    let (url, metrics) = run_server().await?;
    let pooled = benchmark(&url, &metrics, requests, concurrency, true).await?;

    println!(
        "requests={requests} concurrency={concurrency} fresh_client: cold={}us total={}ms p50={}us p95={}us connections={} peak_open_sockets={}",
        fresh.cold_request.as_micros(),
        fresh.elapsed.as_millis(),
        fresh.p50.as_micros(),
        fresh.p95.as_micros(),
        fresh.accepted_connections,
        fresh.peak_open_sockets,
    );
    println!(
        "requests={requests} concurrency={concurrency} shared_client: cold={}us total={}ms p50={}us p95={}us connections={} peak_open_sockets={}",
        pooled.cold_request.as_micros(),
        pooled.elapsed.as_millis(),
        pooled.p50.as_micros(),
        pooled.p95.as_micros(),
        pooled.accepted_connections,
        pooled.peak_open_sockets,
    );
    Ok(())
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), BenchError> {
    for concurrency in [1, 8] {
        for requests in [100, 1_000, 5_000] {
            run_case(requests, concurrency).await?;
        }
    }
    Ok(())
}
