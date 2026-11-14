use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, time::Duration};
use tauri::{ipc::Channel, State};
use reqwest::redirect::Policy;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use url::Url;

#[derive(Default)]
struct AppState {
    active: Mutex<HashMap<String, CancellationToken>>,
}

#[derive(Serialize, Deserialize)]
struct Model {
    id: String,
}

#[derive(Deserialize)]
struct ModelList {
    data: Vec<Model>,
}

#[derive(Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct ChatEvent {
    kind: &'static str,
    text: Option<String>,
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
}

impl ChatEvent {
    fn delta(text: String) -> Self {
        Self { kind: "delta", text: Some(text), prompt_tokens: None, completion_tokens: None }
    }
    fn usage(prompt: u64, completion: u64) -> Self {
        Self {
            kind: "usage", text: None,
            prompt_tokens: Some(prompt), completion_tokens: Some(completion),
        }
    }
    fn done() -> Self {
        Self { kind: "done", text: None, prompt_tokens: None, completion_tokens: None }
    }
}

fn endpoint(raw: &str) -> Result<String, String> {
    let parsed = Url::parse(raw.trim()).map_err(|_| "Invalid server URL".to_string())?;
    let is_loopback = matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && is_loopback) {
        return Err("Use HTTPS for remote servers. HTTP is allowed only on localhost.".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some()
        || parsed.query().is_some() || parsed.fragment().is_some()
        || parsed.path() != "/" || parsed.host_str().is_none()
    {
        return Err("Enter only the server origin (for example https://192.168.1.50)".into());
    }
    Ok(parsed.as_str().trim_end_matches('/').to_string())
}

fn key_valid(key: &str) -> Result<(), String> {
    if key.len() < 16 || key.len() > 512 || key.contains('\r') || key.contains('\n') {
        return Err("Enter a valid YAG client API key (at least 16 characters).".into());
    }
    Ok(())
}

fn client() -> Result<reqwest::Client, String> {
    // Native OS root stores are respected; TLS certificate checks are never disabled.
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .redirect(Policy::none()) // Never forward a bearer token across redirects.
        .build()
        .map_err(|_| "Could not initialize the secure HTTP client".to_string())
}

async fn response_error(response: reqwest::Response) -> String {
    let status = response.status();
    // Avoid reflecting arbitrary, potentially sensitive upstream error bodies.
    let detail = match status.as_u16() {
        401 => "Invalid API key",
        403 => "Client key lacks the required scope",
        404 => "API endpoint not found",
        429 => "Request rate limit reached",
        502 | 503 | 504 => "Inference backend unavailable or saturated",
        _ => "Request failed",
    };
    format!("HTTP {}: {}", status.as_u16(), detail)
}

#[tauri::command]
async fn list_models(url: String, api_key: String) -> Result<Vec<Model>, String> {
    let origin = endpoint(&url)?;
    key_valid(&api_key)?;
    let response = client()?
        .get(format!("{origin}/v1/models"))
        .bearer_auth(&api_key)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| "Cannot reach YAG. Check server address, network and trusted TLS CA.".to_string())?;
    if !response.status().is_success() {
        return Err(response_error(response).await);
    }
    let mut models = response.json::<ModelList>().await
        .map_err(|_| "Server returned an invalid model inventory".to_string())?.data;
    models.retain(|model| !model.id.is_empty() && model.id.len() <= 255);
    models.sort_by(|a, b| a.id.cmp(&b.id));
    models.dedup_by(|a, b| a.id == b.id);
    Ok(models)
}

#[derive(Serialize)]
struct ChatPayload<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    stream: bool,
}

#[derive(Debug, PartialEq)]
enum Chunk {
    Delta(String),
    Usage(u64, u64),
    Done,
    Ignore,
}

fn parse_payload(data: &str) -> Result<Vec<Chunk>, String> {
    if data.trim() == "[DONE]" {
        return Ok(vec![Chunk::Done]);
    }
    let value: serde_json::Value = serde_json::from_str(data)
        .map_err(|_| "Malformed streaming response from server".to_string())?;
    if value.get("error").is_some() {
        return Err("Upstream model returned an inference error".into());
    }
    let mut chunks = Vec::new();
    if let Some(content) = value.pointer("/choices/0/delta/content").and_then(|v| v.as_str()) {
        if !content.is_empty() {
            chunks.push(Chunk::Delta(content.to_string()));
        }
    }
    if let Some(usage) = value.get("usage") {
        if let (Some(prompt), Some(completion)) = (
            usage.get("prompt_tokens").and_then(|v| v.as_u64()),
            usage.get("completion_tokens").and_then(|v| v.as_u64()),
        ) {
            chunks.push(Chunk::Usage(prompt, completion));
        }
    }
    if chunks.is_empty() {
        chunks.push(Chunk::Ignore);
    }
    Ok(chunks)
}

fn dispatch_sse(data: &mut String, on_event: &Channel<ChatEvent>) -> Result<bool, String> {
    if data.is_empty() {
        return Ok(false);
    }
    let payload = data.trim_end_matches('\n');
    let events = parse_payload(payload)?;
    data.clear();
    for event in events {
        let result = match event {
            Chunk::Delta(text) => on_event.send(ChatEvent::delta(text)),
            Chunk::Usage(prompt, completion) => on_event.send(ChatEvent::usage(prompt, completion)),
            Chunk::Done => return Ok(true),
            Chunk::Ignore => continue,
        };
        if result.is_err() {
            return Err("Desktop window disconnected".into());
        }
    }
    Ok(false)
}

async fn run_chat(
    url: &str,
    api_key: &str,
    model: &str,
    messages: &[ChatMessage],
    cancel: &CancellationToken,
    on_event: &Channel<ChatEvent>,
) -> Result<(), String> {
    let origin = endpoint(url)?;
    key_valid(api_key)?;
    if model.is_empty() || model.len() > 255 {
        return Err("Select a valid model".into());
    }
    if messages.is_empty() || messages.len() > 80
        || messages.iter().any(|m| {
            !matches!(m.role.as_str(), "system" | "user" | "assistant")
                || m.content.is_empty() || m.content.len() > 32768
        })
    {
        return Err("Conversation exceeds the supported message limits".into());
    }
    let payload = ChatPayload { model, messages, stream: true };
    let response = client()?
        .post(format!("{origin}/v1/chat/completions"))
        .bearer_auth(api_key)
        .json(&payload)
        .timeout(Duration::from_secs(3600))
        .send()
        .await
        .map_err(|_| "Cannot start inference. Check the server, model and TLS trust.".to_string())?;
    if !response.status().is_success() {
        return Err(response_error(response).await);
    }

    let mut stream = response.bytes_stream();
    let mut pending = Vec::<u8>::new();
    let mut data = String::new();
    let mut finished = false;
    loop {
        let next = tokio::select! {
            _ = cancel.cancelled() => return Err("Generation stopped".into()),
            next = stream.next() => next,
        };
        let Some(next) = next else { break };
        let bytes = next.map_err(|_| "Streaming connection interrupted".to_string())?;
        pending.extend_from_slice(&bytes);
        if pending.len() > 262144 {
            return Err("Streaming event exceeded the size limit".into());
        }
        while let Some(index) = pending.iter().position(|&b| b == b'\n') {
            let mut line = pending.drain(..=index).collect::<Vec<u8>>();
            line.pop(); // trailing LF
            if line.last() == Some(&b'\r') { line.pop(); }
            let line = std::str::from_utf8(&line)
                .map_err(|_| "Invalid UTF-8 in model response".to_string())?;
            if line.is_empty() {
                if dispatch_sse(&mut data, on_event)? {
                    finished = true;
                    break;
                }
            } else if let Some(value) = line.strip_prefix("data:") {
                if data.len() + value.len() > 262144 {
                    return Err("Streaming data exceeded the size limit".into());
                }
                data.push_str(value.trim_start());
                data.push('\n');
            }
        }
        if finished { break; }
    }
    if !finished && !pending.is_empty() {
        let tail = std::str::from_utf8(&pending)
            .map_err(|_| "Incomplete UTF-8 in model response".to_string())?;
        if let Some(value) = tail.trim_end_matches('\r').strip_prefix("data:") {
            data.push_str(value.trim_start());
        }
    }
    if !finished {
        finished = dispatch_sse(&mut data, on_event)?;
    }
    if !finished {
        return Err("Stream ended without a completion marker".into());
    }
    let _ = on_event.send(ChatEvent::done());
    Ok(())
}

#[tauri::command]
async fn stream_chat(
    url: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
    request_id: String,
    on_event: Channel<ChatEvent>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if request_id.is_empty() || request_id.len() > 80 {
        return Err("Invalid request ID".into());
    }
    let cancel = CancellationToken::new();
    {
        let mut active = state.active.lock().await;
        if active.contains_key(&request_id) {
            return Err("Duplicate request ID".into());
        }
        active.insert(request_id.clone(), cancel.clone());
    }
    let result = tokio::select! {
        _ = cancel.cancelled() => Err("Generation stopped".into()),
        result = run_chat(&url, &api_key, &model, &messages, &cancel, &on_event) => result,
    };
    state.active.lock().await.remove(&request_id);
    result
}

#[tauri::command]
async fn cancel_chat(request_id: String, state: State<'_, AppState>) -> Result<(), String> {
    if let Some(token) = state.active.lock().await.get(&request_id) {
        token.cancel();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![list_models, stream_chat, cancel_chat])
        .run(tauri::generate_context!())
        .expect("failed to launch YAG Desktop");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_requires_tls_for_remote_hosts() {
        assert_eq!(endpoint("https://192.168.1.50").unwrap(), "https://192.168.1.50");
        assert_eq!(endpoint("http://localhost:8080").unwrap(), "http://localhost:8080");
        assert!(endpoint("http://192.168.1.50").is_err());
        assert!(endpoint("https://example.com/path").is_err());
        assert!(endpoint("https://user:password@example.com").is_err());
        assert!(endpoint("file:///etc/passwd").is_err());
        assert!(endpoint("https://example.com/?x=1").is_err());
    }

    #[test]
    fn parses_streaming_deltas_and_usage() {
        assert_eq!(parse_payload("[DONE]").unwrap(), vec![Chunk::Done]);
        assert_eq!(
            parse_payload(r#"{"choices":[{"delta":{"content":"Hello"}}]}"#).unwrap(),
            vec![Chunk::Delta("Hello".into())]
        );
        assert_eq!(
            parse_payload(r#"{"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":9}}"#).unwrap(),
            vec![Chunk::Usage(3, 9)]
        );
        assert!(parse_payload("not json").is_err());
    }
}
