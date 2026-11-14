//! Opt-in, strictly loopback OpenAI-compatible relay.
//! No host credentials are exposed on the local HTTP interface.
use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use futures_util::StreamExt;
use serde::Serialize;
use std::{sync::Arc, time::Duration};
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Clone, Serialize)]
pub(crate) struct RelayInfo {
    pub url: String,
    pub token: String,
}

pub(crate) struct RelayHandle {
    pub cancel: CancellationToken,
}
struct RelayContext {
    upstream: String,
    upstream_key: String,
    local_token: String,
    port: u16,
    cancel: CancellationToken,
    client: reqwest::Client,
}

fn authenticate(headers: &HeaderMap, local_token: &str, port: u16) -> bool {
    // Reject browser cross-origin calls and DNS rebinding even if a browser
    // somehow learns the relay port. No CORS headers or cookies are supported.
    if headers.contains_key(header::ORIGIN) { return false; }
    let host = headers.get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or("");
    let accepted = host.eq_ignore_ascii_case(&format!("127.0.0.1:{port}"))
        || host.eq_ignore_ascii_case(&format!("localhost:{port}"));
    if !accepted { return false; }
    let bearer = headers.get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok()).unwrap_or("");
    let Some(token) = bearer.strip_prefix("Bearer ") else { return false };
    token == local_token
}

async fn forward(
    ctx: Arc<RelayContext>,
    headers: HeaderMap,
    body: Option<Bytes>,
    target: &'static str,
) -> Response {
    if ctx.cancel.is_cancelled() { return StatusCode::SERVICE_UNAVAILABLE.into_response(); }
    if !authenticate(&headers, &ctx.local_token, ctx.port) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let mut request = if target == "models" {
        ctx.client.get(format!("{}/v1/models", ctx.upstream))
    } else {
        let Some(bytes) = body else { return StatusCode::BAD_REQUEST.into_response() };
        if bytes.is_empty() || bytes.len() > 1_048_576 {
            return StatusCode::PAYLOAD_TOO_LARGE.into_response();
        }
        let Ok(json) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
            return StatusCode::BAD_REQUEST.into_response();
        };
        if !json.get("model").and_then(|v| v.as_str()).is_some_and(|v| !v.is_empty())
            || !json.get("messages").is_some_and(|v| v.is_array()) {
            return StatusCode::BAD_REQUEST.into_response();
        }
        ctx.client.post(format!("{}/v1/chat/completions", ctx.upstream))
            .header(header::CONTENT_TYPE, "application/json")
            .body(bytes)
    };
    request = request.bearer_auth(&ctx.upstream_key).timeout(Duration::from_secs(3600));
    let response = match tokio::select! {
        _ = ctx.cancel.cancelled() => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
        value = request.send() => value,
    } {
        Ok(response) => response,
        Err(_) => return StatusCode::BAD_GATEWAY.into_response(),
    };
    let status = response.status();
    let content_type = response.headers().get(header::CONTENT_TYPE).cloned();
    let retry_after = response.headers().get(header::RETRY_AFTER).cloned();
    // Backpressure is preserved; cancellation immediately stops ongoing SSE.
    let stream = response.bytes_stream().take_until(ctx.cancel.clone().cancelled_owned());
    let mut reply = Response::new(Body::from_stream(stream));
    *reply.status_mut() = status;
    if let Some(v) = content_type { reply.headers_mut().insert(header::CONTENT_TYPE, v); }
    if let Some(v) = retry_after { reply.headers_mut().insert(header::RETRY_AFTER, v); }
    reply
}
async fn models(State(ctx): State<Arc<RelayContext>>, headers: HeaderMap) -> Response {
    forward(ctx, headers, None, "models").await
}
async fn chat(State(ctx): State<Arc<RelayContext>>, headers: HeaderMap, bytes: Bytes) -> Response {
    forward(ctx, headers, Some(bytes), "chat").await
}

pub(crate) async fn start(upstream: String, upstream_key: String) -> Result<(RelayInfo, RelayHandle), String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await
        .map_err(|_| "Could not open an available localhost port".to_string())?;
    let port = listener.local_addr().map_err(|_| "Could not read localhost port")?.port();
    let token = format!("yag-relay-{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let cancel = CancellationToken::new();
    let context = Arc::new(RelayContext {
        upstream, upstream_key, local_token: token.clone(), port,
        cancel: cancel.clone(), client: super::client()?,
    });
    let app = Router::new()
        .route("/v1/models", get(models))
        .route("/v1/chat/completions", post(chat))
        .layer(DefaultBodyLimit::max(1_048_576))
        .with_state(context);
    let shutdown = cancel.clone();
    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move { shutdown.cancelled().await })
            .await;
    });
    Ok((RelayInfo {url: format!("http://127.0.0.1:{port}"), token}, RelayHandle {cancel}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn relay_rejects_bad_hosts_origins_and_missing_tokens() {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, "127.0.0.1:47622".parse().unwrap());
        headers.insert(header::AUTHORIZATION, "Bearer relay-token".parse().unwrap());
        assert!(authenticate(&headers, "relay-token", 47622));
        headers.insert(header::HOST, "evil.test:47622".parse().unwrap());
        assert!(!authenticate(&headers, "relay-token", 47622));
        headers.insert(header::HOST, "localhost:47622".parse().unwrap());
        headers.insert(header::ORIGIN, "https://untrusted.test".parse().unwrap());
        assert!(!authenticate(&headers, "relay-token", 47622));
        headers.remove(header::ORIGIN);
        assert!(!authenticate(&headers, "bad-token", 47622));
    }
}
