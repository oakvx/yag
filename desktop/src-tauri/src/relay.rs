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
use std::{collections::BTreeSet, sync::Arc, time::Duration};
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
    allowed_models: BTreeSet<String>,
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

async fn forward_chat(ctx: Arc<RelayContext>, headers: HeaderMap, bytes: Bytes) -> Response {
    if ctx.cancel.is_cancelled() { return StatusCode::SERVICE_UNAVAILABLE.into_response(); }
    if !authenticate(&headers, &ctx.local_token, ctx.port) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if bytes.is_empty() || bytes.len() > 1_048_576 {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    }
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Some(model) = json.get("model").and_then(|v| v.as_str()) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if model.is_empty() || !json.get("messages").is_some_and(|v| v.is_array()) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    // Only the models explicitly allowed when starting the relay can be used.
    // This is a second, local safety gate; Host authentication/scopes still apply.
    if !ctx.allowed_models.contains(model) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let request = ctx.client.post(format!("{}/v1/chat/completions", ctx.upstream))
        .header(header::CONTENT_TYPE, "application/json")
        .body(bytes)
        .bearer_auth(&ctx.upstream_key)
        .timeout(Duration::from_secs(3600));
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
    let stream = response.bytes_stream().take_until(ctx.cancel.clone().cancelled_owned());
    let mut reply = Response::new(Body::from_stream(stream));
    *reply.status_mut() = status;
    if let Some(v) = content_type { reply.headers_mut().insert(header::CONTENT_TYPE, v); }
    if let Some(v) = retry_after { reply.headers_mut().insert(header::RETRY_AFTER, v); }
    reply
}
async fn models(State(ctx): State<Arc<RelayContext>>, headers: HeaderMap) -> Response {
    if ctx.cancel.is_cancelled() { return StatusCode::SERVICE_UNAVAILABLE.into_response(); }
    if !authenticate(&headers, &ctx.local_token, ctx.port) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    // Expose only the initial explicitly authorized model snapshot, never the
    // entire upstream inventory (which may include paid external providers).
    let data: Vec<_> = ctx.allowed_models.iter()
        .map(|id| serde_json::json!({"id": id, "object": "model"})).collect();
    axum::Json(serde_json::json!({"object":"list", "data":data})).into_response()
}
async fn chat(State(ctx): State<Arc<RelayContext>>, headers: HeaderMap, bytes: Bytes) -> Response {
    forward_chat(ctx, headers, bytes).await
}

pub(crate) async fn start(upstream: String, upstream_key: String, model_ids: Vec<String>) -> Result<(RelayInfo, RelayHandle), String> {
    let allowed_models = model_ids.into_iter().collect::<BTreeSet<_>>();
    if allowed_models.is_empty() || allowed_models.len() > 512 {
        return Err("Relay requires 1–512 explicitly authorized model IDs".into());
    }
    let listener = TcpListener::bind(("127.0.0.1", 0)).await
        .map_err(|_| "Could not open an available localhost port".to_string())?;
    let port = listener.local_addr().map_err(|_| "Could not read localhost port")?.port();
    let token = format!("yag-relay-{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let cancel = CancellationToken::new();
    let context = Arc::new(RelayContext {
        upstream, upstream_key, local_token: token.clone(), port,
        cancel: cancel.clone(), client: super::client()?, allowed_models,
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
    #[tokio::test]
    async fn localhost_relay_passes_models_and_chat_without_exposing_upstream_key() {
        let backend = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let upstream = format!("http://{}", backend.local_addr().unwrap());
        let routes = Router::new()
            .route("/v1/models", get(|| async {
                ([(header::CONTENT_TYPE, "application/json")],
                r#"{"data":[{"id":"unit-model"},{"id":"paid-cloud"}],"object":"list"}"#)
            }))
            .route("/v1/chat/completions", post(|| async {
                ([(header::CONTENT_TYPE, "text/event-stream")],
                "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n")
            }));
        let server = tokio::spawn(async move { axum::serve(backend, routes).await.unwrap(); });
        let (info, handle) = start(upstream, "host-private-key".into(), vec!["unit-model".into()]).await.unwrap();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let unauthorized = client.get(format!("{}/v1/models", info.url))
            .bearer_auth("wrong").send().await.unwrap();
        assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);
        let forbidden_browser = client.get(format!("{}/v1/models", info.url))
            .bearer_auth(&info.token).header(header::ORIGIN, "https://evil.test")
            .send().await.unwrap();
        assert_eq!(forbidden_browser.status(), StatusCode::UNAUTHORIZED);
        let models = client.get(format!("{}/v1/models", info.url))
            .bearer_auth(&info.token).send().await.unwrap();
        assert_eq!(models.status(), StatusCode::OK);
        let visible = models.text().await.unwrap();
        assert!(visible.contains("unit-model"));
        assert!(!visible.contains("paid-cloud"));
        let chat = client.post(format!("{}/v1/chat/completions", info.url))
            .bearer_auth(&info.token)
            .json(&serde_json::json!({"model":"unit-model","messages":[{"role":"user","content":"hi"}],"stream":true}))
            .send().await.unwrap();
        assert_eq!(chat.status(), StatusCode::OK);
        assert!(chat.text().await.unwrap().contains("[DONE]"));
        let paid = client.post(format!("{}/v1/chat/completions", info.url))
            .bearer_auth(&info.token)
            .json(&serde_json::json!({"model":"paid-cloud","messages":[{"role":"user","content":"hi"}]}))
            .send().await.unwrap();
        assert_eq!(paid.status(), StatusCode::FORBIDDEN);
        let wrong_route = client.get(format!("{}/v1/something-else", info.url))
            .bearer_auth(&info.token).send().await.unwrap();
        assert_eq!(wrong_route.status(), StatusCode::NOT_FOUND);
        handle.cancel.cancel();
        server.abort();
    }

    #[tokio::test]
    async fn cannot_start_relay_with_empty_authorized_inventory() {
        assert!(start("http://127.0.0.1:11434".into(), "not-a-real-key".into(), vec![])
            .await.is_err());
    }

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
