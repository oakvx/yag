//! Discovery only proposes candidate gateways: it does not authenticate them,
//! trust certificates, fetch model lists or connect automatically.
use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::Serialize;
use std::{collections::BTreeMap, net::IpAddr, time::{Duration, Instant}};

const SERVICE: &str = "_yag._tcp.local.";

#[derive(Clone, Serialize)]
pub(crate) struct DiscoveredHost {
    pub name: String,
    pub url: String,
}

fn allowed_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_private() || ip.is_loopback() || ip.is_link_local(),
        // The deployed LAN manager currently configures IPv4 Caddy listeners.
        IpAddr::V6(_) => false,
    }
}

pub(crate) async fn scan() -> Result<Vec<DiscoveredHost>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let daemon = ServiceDaemon::new()
            .map_err(|_| "Local multicast DNS is unavailable".to_string())?;
        let receiver = daemon.browse(SERVICE)
            .map_err(|_| "Unable to browse for YAG hosts".to_string())?;
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut candidates = BTreeMap::new();
        while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
            if remaining.is_zero() { break }
            match receiver.recv_timeout(remaining) {
                Ok(ServiceEvent::ServiceResolved(info)) => {
                    let port = info.get_port();
                    if port == 0 { continue; }
                    let name = info.get_fullname().chars().take(100).collect::<String>();
                    for addr in info.get_addresses() {
                        if !allowed_address(*addr) { continue; }
                        let url = format!("https://{}:{port}", addr);
                        candidates.insert(url.clone(), DiscoveredHost {name: name.clone(), url});
                    }
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        let _ = daemon.stop_browse(SERVICE);
        let _ = daemon.shutdown();
        Ok(candidates.into_values().collect::<Vec<_>>())
    })
    .await
    .map_err(|_| "LAN discovery task failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovery_does_not_suggest_public_servers() {
        assert!(allowed_address("192.168.1.50".parse().unwrap()));
        assert!(allowed_address("10.0.0.12".parse().unwrap()));
        assert!(!allowed_address("8.8.8.8".parse().unwrap()));
        assert!(!allowed_address("2001:4860:4860::8888".parse().unwrap()));
    }
}
