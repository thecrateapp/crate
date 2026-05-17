//! Minimal HTTP server for the media worker. Handles album packaging, track artifact
//! generation, and health checks over a plain TCP socket.

use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

use serde_json::json;

use crate::package::{build_album_package, build_track_artifact, PackageJob, TrackArtifactJob};

const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_BODY_BYTES: usize = 16 * 1024 * 1024;

pub fn serve(addr: &str) -> io::Result<()> {
    let listener = TcpListener::bind(addr)?;
    eprintln!("crate-media-worker listening on {addr}");

    for stream in listener.incoming() {
        match stream {
            Ok(mut stream) => {
                if let Err(err) = handle_connection(&mut stream) {
                    eprintln!("crate-media-worker request failed: {err}");
                }
            }
            Err(err) => eprintln!("crate-media-worker accept failed: {err}"),
        }
    }

    Ok(())
}

fn handle_connection(stream: &mut TcpStream) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(30)))?;
    stream.set_write_timeout(Some(Duration::from_secs(300)))?;

    let request = read_request(stream)?;
    handle_request(request, stream)
}

fn handle_request<W: Write>(request: Request, writer: &mut W) -> io::Result<()> {
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/healthz") => write_json(
            writer,
            200,
            json!({"ok": true, "service": "crate-media-worker"}),
        ),
        ("POST", "/v1/packages/album") => {
            let job: Result<PackageJob, _> = serde_json::from_slice(&request.body);
            match job {
                Ok(job) => {
                    let result = build_album_package(job);
                    let status = if result.ok { 200 } else { 500 };
                    write_json(writer, status, serde_json::to_value(result).unwrap_or_else(|err| {
                        json!({"ok": false, "errors": [format!("serialize response: {err}")]})
                    }))
                }
                Err(err) => write_json(
                    writer,
                    400,
                    json!({"ok": false, "errors": [format!("invalid package job: {err}")]}),
                ),
            }
        }
        ("POST", "/v1/packages/track") => {
            let job: Result<TrackArtifactJob, _> = serde_json::from_slice(&request.body);
            match job {
                Ok(job) => {
                    let result = build_track_artifact(job);
                    let status = if result.ok { 200 } else { 500 };
                    write_json(
                        writer,
                        status,
                        serde_json::to_value(result).unwrap_or_else(|err| {
                            json!({"ok": false, "errors": [format!("serialize response: {err}")]})
                        }),
                    )
                }
                Err(err) => write_json(
                    writer,
                    400,
                    json!({"ok": false, "errors": [format!("invalid track artifact job: {err}")]}),
                ),
            }
        }
        _ => write_json(
            writer,
            404,
            json!({"ok": false, "errors": ["unknown route"]}),
        ),
    }
}

struct Request {
    method: String,
    path: String,
    body: Vec<u8>,
}

fn read_request<R: Read>(stream: &mut R) -> io::Result<Request> {
    let mut buffer = Vec::with_capacity(8192);
    let mut chunk = [0_u8; 4096];
    let header_end;

    loop {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "connection closed before headers",
            ));
        }
        buffer.extend_from_slice(&chunk[..read]);

        if let Some(index) = find_header_end(&buffer) {
            header_end = index;
            break;
        }

        if buffer.len() > MAX_HEADER_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "headers exceed maximum size",
            ));
        }
    }

    let headers_raw = &buffer[..header_end];
    let mut body = buffer[header_end + 4..].to_vec();
    let headers_text = std::str::from_utf8(headers_raw)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
    let mut lines = headers_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing HTTP request line"))?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or("").to_string();
    let path = request_parts.next().unwrap_or("").to_string();

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);

    if content_length > MAX_BODY_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "body exceeds maximum size",
        ));
    }

    while body.len() < content_length {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "connection closed before body was complete",
            ));
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(content_length);

    Ok(Request { method, path, body })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn write_json<W: Write>(
    stream: &mut W,
    status: u16,
    payload: serde_json::Value,
) -> io::Result<()> {
    let status_text = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let body = serde_json::to_vec(&payload)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
    write!(
        stream,
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    stream.write_all(&body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    // ── find_header_end ──────────────────────────────────────────────

    #[test]
    fn find_header_end_at_start() {
        let buf = b"GET / HTTP/1.1\r\nHost: x\r\n\r\nbody";
        let pos = find_header_end(buf);
        assert!(pos.is_some());
        let pos = pos.unwrap();
        assert_eq!(&buf[pos..pos + 4], b"\r\n\r\n");
    }

    #[test]
    fn find_header_end_in_middle() {
        let buf = b"header\r\n\r\nbody continues";
        let pos = find_header_end(buf);
        assert!(pos.is_some());
        let pos = pos.unwrap();
        assert_eq!(&buf[pos..pos + 4], b"\r\n\r\n");
    }

    #[test]
    fn find_header_end_not_found() {
        let buf = b"partial header without ending";
        assert_eq!(find_header_end(buf), None);
    }

    #[test]
    fn find_header_end_empty_buffer() {
        let buf: &[u8] = b"";
        assert_eq!(find_header_end(buf), None);
    }

    #[test]
    fn find_header_end_small_buffer() {
        let buf: &[u8] = b"abc";
        assert_eq!(find_header_end(buf), None);
    }

    #[test]
    fn find_header_end_only_crlfcrlf() {
        let buf: &[u8] = b"\r\n\r\n";
        assert_eq!(find_header_end(buf), Some(0));
    }

    // ── HTTP routing tests ───────────────────────────────────────────

    fn send_raw_request(raw: &[u8]) -> Vec<u8> {
        let mut input = Cursor::new(raw.to_vec());
        let request = read_request(&mut input).unwrap();
        let mut response = Vec::new();
        handle_request(request, &mut response).unwrap();
        response
    }

    fn build_request(method: &str, path: &str, body: &[u8]) -> Vec<u8> {
        let mut req = format!(
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        req.extend_from_slice(body);
        req
    }

    #[test]
    fn healthz_returns_200() {
        let req = build_request("GET", "/healthz", b"");
        let resp = send_raw_request(&req);
        let body = String::from_utf8_lossy(&resp);
        assert!(body.contains("200 OK"));
        assert!(body.contains("\"ok\":true"));
        assert!(body.contains("crate-media-worker"));
    }

    #[test]
    fn unknown_route_returns_404() {
        let req = build_request("GET", "/nonexistent", b"");
        let resp = send_raw_request(&req);
        let body = String::from_utf8_lossy(&resp);
        assert!(body.contains("404 Not Found"));
        assert!(body.contains("unknown route"));
    }

    #[test]
    fn unknown_method_on_known_path_returns_404() {
        let req = build_request("DELETE", "/healthz", b"");
        let resp = send_raw_request(&req);
        let body = String::from_utf8_lossy(&resp);
        assert!(body.contains("404 Not Found"));
    }

    #[test]
    fn album_package_invalid_json_returns_400() {
        let req = build_request("POST", "/v1/packages/album", b"not valid json");
        let resp = send_raw_request(&req);
        let body = String::from_utf8_lossy(&resp);
        assert!(body.contains("400 Bad Request"));
        assert!(body.contains("invalid package job"));
    }

    #[test]
    fn track_artifact_invalid_json_returns_400() {
        let req = build_request("POST", "/v1/packages/track", b"garbage");
        let resp = send_raw_request(&req);
        let body = String::from_utf8_lossy(&resp);
        assert!(body.contains("400 Bad Request"));
        assert!(body.contains("invalid track artifact job"));
    }

    #[test]
    fn response_has_json_content_type() {
        let req = build_request("GET", "/healthz", b"");
        let resp = send_raw_request(&req);
        let body = String::from_utf8_lossy(&resp);
        assert!(body.contains("Content-Type: application/json"));
    }

    // ── read_request unit tests ──────────────────────────────────────

    #[test]
    fn read_request_parses_method_and_path() {
        let raw = build_request("POST", "/api/test", b"hello");
        let mut input = Cursor::new(raw);
        let req = read_request(&mut input).unwrap();
        assert_eq!(req.method, "POST");
        assert_eq!(req.path, "/api/test");
        assert_eq!(req.body, b"hello");
    }

    #[test]
    fn read_request_empty_body() {
        let raw = build_request("GET", "/test", b"");
        let mut input = Cursor::new(raw);
        let req = read_request(&mut input).unwrap();
        assert_eq!(req.body, b"");
    }
}
