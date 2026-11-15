//! Explicit GitHub release discovery and checksum-verified download.
//! This does not run installers: unsigned Desktop binaries require manual review.
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs::{self, OpenOptions}, io::{self, Write}, path::PathBuf, time::Duration};
use futures_util::StreamExt;
use uuid::Uuid;
use tauri::Manager;

const API: &str = "https://api.github.com/repos/oakvx/yag/releases?per_page=30";
const DOWNLOAD_ROOT: &str = "https://github.com/oakvx/yag/releases/download";
const RELEASE_PAGE: &str = "https://github.com/oakvx/yag/releases/tag";
const MAX_METADATA: usize = 1_048_576;
const MAX_INSTALLER: u64 = 128 * 1024 * 1024;

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    size: u64,
}
#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Serialize)]
pub(crate) struct VersionInfo {
    pub current: String,
    pub latest: String,
    pub url: String,
    pub channel: String,
    pub update_available: bool,
    pub download_supported: bool,
    pub asset_name: Option<String>,
}

#[derive(Debug, Clone, Copy, Eq, Ord, PartialEq, PartialOrd)]
struct Version(u64, u64, u64, u8, u64);

fn component(raw: &str) -> Option<u64> {
    if raw.is_empty() || (raw.len() > 1 && raw.starts_with('0'))
        || !raw.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    raw.parse().ok()
}

fn valid_weekly_monday(year: u64, month: u64, day: u64) -> bool {
    if !(2020..=2099).contains(&year) || !(1..=12).contains(&month) { return false; }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if day == 0 || day > days[(month - 1) as usize] { return false; }
    // Sakamoto's Gregorian day-of-week algorithm: Sunday = 0, Monday = 1.
    let offsets = [0u64, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    let y = if month < 3 { year - 1 } else { year };
    (y + y / 4 - y / 100 + y / 400 + offsets[(month - 1) as usize] + day) % 7 == 1
}

fn tagged_release_build() -> bool {
    let expected = format!("v{}", env!("CARGO_PKG_VERSION"));
    option_env!("YAG_DESKTOP_RELEASE_TAG") == Some(expected.as_str())
}

fn version(raw: &str) -> Option<Version> {
    let raw = raw.strip_prefix('v').unwrap_or(raw);
    if raw.len() > 56 { return None; }
    let (core, suffix) = raw.split_once('-').map_or((raw, None), |(a, b)| (a, Some(b)));
    let mut parts = core.split('.');
    let (major, minor, patch) =
        (component(parts.next()?)?, component(parts.next()?)?, component(parts.next()?)?);
    if parts.next().is_some() { return None; }
    let (channel, index) = match suffix {
        None => (2, 0),
        Some(s) if s.starts_with("rc.") => {
            let id = component(s.strip_prefix("rc.")?)?;
            if id == 0 { return None; }
            (0, id)
        }
        Some(s) if s.starts_with("weekly.") => {
            let date = s.strip_prefix("weekly.")?;
            if date.len() != 8 || !date.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            let year = component(&date[..4])?;
            let month = component(&date[4..6])?;
            let day = component(&date[6..8])?;
            if !valid_weekly_monday(year, month, day) { return None; }
            (1, component(date)?)
        }
        _ => return None,
    };
    Some(Version(major, minor, patch, channel, index))
}

fn filenames(tag: &str) -> [String; 4] {
    [
        "yag-linux-x86_64.tar.gz".to_string(),
        format!("yag-desktop-{tag}-linux.deb"),
        format!("yag-desktop-{tag}-windows.exe"),
        format!("yag-desktop-{tag}-macos.dmg"),
    ]
}

fn installer_name(tag: &str) -> Option<String> {
    if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Some(format!("yag-desktop-{tag}-linux.deb"))
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Some(format!("yag-desktop-{tag}-windows.exe"))
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some(format!("yag-desktop-{tag}-macos.dmg"))
    } else {
        None // Never recommend an installer for a different CPU architecture.
    }
}

fn complete(release: &GithubRelease) -> bool {
    if !release.tag_name.starts_with('v') || version(&release.tag_name).is_none() {
        return false;
    }
    let expected = filenames(&release.tag_name);
    expected.iter().all(|name| release.assets.iter()
        .filter(|asset| asset.name == *name && asset.size > 0 && asset.size <= MAX_INSTALLER)
        .count() == 1)
        && release.assets.iter().filter(|asset| asset.name == "SHA256SUMS.txt"
            && asset.size > 0 && asset.size <= 4096).count() == 1
}

fn preferred(releases: &[GithubRelease]) -> Option<&GithubRelease> {
    releases.iter().filter(|release| !release.draft && complete(release))
        .max_by_key(|release| version(&release.tag_name))
}

fn restricted_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .redirect(Policy::custom(|attempt| {
            let url = attempt.url();
            if attempt.previous().len() >= 4 || url.scheme() != "https"
                || !matches!(url.host_str(), Some(
                    "api.github.com" | "github.com" | "release-assets.githubusercontent.com"
                    | "objects.githubusercontent.com"
                )) {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| "Cannot initialize secure update client".into())
}

async fn bounded_get(client: &reqwest::Client, url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let response = client.get(url).header("User-Agent", "YAG-Desktop-Update-Check")
        .timeout(Duration::from_secs(45)).send().await
        .map_err(|_| "Cannot connect securely to GitHub Releases".to_string())?;
    if !response.status().is_success() {
        return Err(format!("GitHub Releases returned HTTP {}", response.status().as_u16()));
    }
    if response.content_length().is_some_and(|length| length > limit as u64) {
        return Err("Downloaded metadata or package exceeds size limit".into());
    }
    let mut output = Vec::new();
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "GitHub download interrupted".to_string())?;
        if chunk.len() > limit.saturating_sub(output.len()) {
            return Err("Downloaded metadata or package exceeds size limit".into());
        }
        output.extend_from_slice(&chunk);
    }
    Ok(output)
}

async fn all_releases(client: &reqwest::Client) -> Result<Vec<GithubRelease>, String> {
    let bytes = bounded_get(client, API, MAX_METADATA).await?;
    serde_json::from_slice(&bytes).map_err(|_| "Invalid GitHub Releases response".into())
}

fn status_from(releases: &[GithubRelease], current: &str, tagged: bool) -> Result<VersionInfo, String> {
    let installed = version(current).ok_or("Invalid installed application version")?;
    let release = preferred(releases).ok_or("No complete YAG releases published yet")?;
    let latest_version = version(&release.tag_name).ok_or("Invalid release version")?;
    let asset = installer_name(&release.tag_name);
    // Development artifacts are not signed/tagged releases. A 0.1.0 local
    // build can upgrade to 0.1.0-rc.N or 0.1.0-weekly.YYYYMMDD, while an
    // actual stable 0.1.0 install never downgrades to those prereleases.
    let dev_same_core = !tagged && installed.3 == 2 && latest_version.3 != 2
        && (installed.0, installed.1, installed.2)
            == (latest_version.0, latest_version.1, latest_version.2);
    Ok(VersionInfo {
        current: if tagged { current.into() } else { format!("{current} (local build)") },
        latest: release.tag_name.clone(),
        url: format!("{RELEASE_PAGE}/{}", release.tag_name),
        channel: if latest_version.3 == 1 { "weekly" } else if latest_version.3 == 0 {
            "candidate"
        } else { "stable" }.into(),
        update_available: latest_version > installed || dev_same_core,
        download_supported: asset.is_some(),
        asset_name: asset,
    })
}

pub(crate) async fn check() -> Result<VersionInfo, String> {
    let client = restricted_client()?;
    let releases = all_releases(&client).await?;
    status_from(&releases, env!("CARGO_PKG_VERSION"), tagged_release_build())
}

fn checksums(input: &[u8], tag: &str) -> Result<BTreeMap<String, String>, String> {
    if input.len() > 4096 { return Err("Oversized checksum manifest".into()); }
    let source = std::str::from_utf8(input).map_err(|_| "Invalid checksum manifest encoding")?;
    let expected = filenames(tag);
    let mut map = BTreeMap::new();
    for line in source.lines() {
        let (hash, name) = line.split_once("  ").ok_or("Malformed checksum line")?;
        if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit())
            || !expected.iter().any(|expected_name| expected_name == name)
            || map.insert(name.to_string(), hash.to_ascii_lowercase()).is_some() {
            return Err("Invalid or duplicate checksum entry".into());
        }
    }
    if map.len() != expected.len() { return Err("Incomplete checksum manifest".into()); }
    Ok(map)
}

struct RemoveOnDrop(PathBuf);
impl Drop for RemoveOnDrop {
    fn drop(&mut self) { let _ = fs::remove_file(&self.0); }
}

fn publish_verified(source: &std::path::Path, target: &std::path::Path,
                    expected_size: u64) -> Result<(), String> {
    // create_new refuses existing files, including symlinks, on every OS.
    let mut destination = OpenOptions::new().write(true).create_new(true).open(target)
        .map_err(|_| "A file with this installer name already exists in Downloads")?;
    let copied = (|| -> io::Result<u64> {
        let mut input = fs::File::open(source)?;
        let copied = io::copy(&mut input, &mut destination)?;
        destination.sync_all()?;
        Ok(copied)
    })();
    drop(destination);
    match copied {
        Ok(n) if n == expected_size => Ok(()),
        _ => {
            let _ = fs::remove_file(target);
            Err("Cannot publish the complete verified installer".into())
        }
    }
}

async fn stream_verified_package(client: &reqwest::Client, url: &str, size: u64,
                                 expected_sha256: &str, destination: &std::path::Path)
    -> Result<(), String> {
    if size == 0 || size > MAX_INSTALLER { return Err("Unexpected installer size".into()); }
    let response = client.get(url).header("User-Agent", "YAG-Desktop-Update-Check")
        .timeout(Duration::from_secs(600)).send().await
        .map_err(|_| "Could not download GitHub release installer".to_string())?;
    if !response.status().is_success() {
        return Err(format!("GitHub installer download returned HTTP {}", response.status().as_u16()));
    }
    if response.content_length().is_some_and(|header| header != size) {
        return Err("Installer size disagrees with GitHub release metadata".into());
    }

    let parent = destination.parent().ok_or("Invalid Downloads directory")?;
    let filename = destination.file_name().and_then(|name| name.to_str())
        .ok_or("Invalid installer filename")?;
    let temp = parent.join(format!(".{filename}-{}.partial", Uuid::new_v4().simple()));
    // Declare the cleanup guard before the file so Windows closes the handle
    // before attempting to delete an interrupted or corrupt temporary file.
    let _cleanup = RemoveOnDrop(temp.clone());
    let mut file = OpenOptions::new().write(true).create_new(true).open(&temp)
        .map_err(|_| "Cannot create a private temporary installer file")?;

    let mut stream = response.bytes_stream();
    let mut hasher = Sha256::new();
    let mut total = 0u64;
    while let Some(next) = stream.next().await {
        let bytes = next.map_err(|_| "Installer download interrupted".to_string())?;
        total = total.checked_add(bytes.len() as u64)
            .ok_or("Installer size exceeded the limit")?;
        if total > size || total > MAX_INSTALLER {
            return Err("Installer exceeded the expected size".into());
        }
        file.write_all(&bytes).map_err(|_| "Cannot write the temporary installer")?;
        hasher.update(&bytes);
    }
    file.sync_all().map_err(|_| "Cannot flush the temporary installer")?;
    drop(file);
    if total != size || format!("{:x}", hasher.finalize()) != expected_sha256 {
        return Err("Installer size or SHA-256 digest did not match the release manifest".into());
    }
    // Publish only after full integrity verification. Never overwrite an
    // existing file, and never execute the installer automatically.
    publish_verified(&temp, destination, total)
}

pub(crate) async fn download(app: tauri::AppHandle, requested: String) -> Result<String, String> {
    // Accept only the selected, complete, strictly parsed latest release.
    // Never accept renderer-supplied URLs or filesystem paths.
    let client = restricted_client()?;
    let releases = all_releases(&client).await?;
    let candidate = preferred(&releases).ok_or("No complete YAG releases published yet")?;
    let available = status_from(&releases, env!("CARGO_PKG_VERSION"), tagged_release_build())?;
    if !available.update_available || requested != candidate.tag_name {
        return Err("Update is no longer current. Check releases again.".into());
    }
    let name = installer_name(&requested)
        .ok_or("No compatible installer for this operating system and CPU")?;
    let asset = candidate.assets.iter().find(|asset| asset.name == name)
        .ok_or("Installer not found in release")?;
    let manifest_url = format!("{DOWNLOAD_ROOT}/{requested}/SHA256SUMS.txt");
    let manifest = bounded_get(&client, &manifest_url, 4096).await?;
    let expected = checksums(&manifest, &requested)?
        .remove(&name).ok_or("Installer checksum missing")?;
    let url = format!("{DOWNLOAD_ROOT}/{requested}/{name}");
    let downloads = app.path().download_dir()
        .map_err(|_| "Cannot locate the system Downloads folder")?;
    let destination = downloads.join(&name);
    if destination.exists() {
        return Err("A file with that installer name already exists in Downloads".into());
    }
    stream_verified_package(&client, &url, asset.size, &expected, &destination).await?;
    Ok(destination.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn example(tag: &str) -> GithubRelease {
        let mut assets = filenames(tag).into_iter()
            .map(|name| GithubAsset { name, size: 1200 }).collect::<Vec<_>>();
        assets.push(GithubAsset { name: "SHA256SUMS.txt".into(), size: 392 });
        GithubRelease { tag_name: tag.into(), draft: false, assets }
    }

    #[test]
    fn strict_versions_reject_injection_and_obey_release_order() {
        for tag in ["v0.1.0", "v0.1.0-rc.2", "v0.1.0-weekly.20261116"] {
            assert!(version(tag).is_some());
        }
        for tag in ["v00.1.0", "v0.1.0/../../evil", "v0.1.0-rc.0",
            "v0.1.0-weekly.2026111", "v0.1.0-weekly.20261332",
            "v0.1.0-weekly.20261115", "v0.1.0-weekly.20260230",
            "v0.1.0-rc.1;touch", "v0.1.0-dev", "v1.2.3.4"] {
            assert!(version(tag).is_none(), "{tag}");
        }
        assert!(version("v0.1.0").unwrap() > version("v0.1.0-weekly.20261116").unwrap());
        assert!(version("v0.1.0-weekly.20261123").unwrap()
            > version("v0.1.0-weekly.20261116").unwrap());
        assert!(version("v0.1.0-weekly.20261116").unwrap()
            > version("v0.1.0-rc.2").unwrap());
        assert!(version("v0.2.0-rc.1").unwrap() > version("v0.1.0").unwrap());
    }

    #[test]
    fn select_complete_non_draft_release_including_weekly() {
        let mut draft = example("v0.2.0");
        draft.draft = true;
        let mut incomplete = example("v0.1.0-weekly.20261123");
        incomplete.assets.retain(|item| item.name != "SHA256SUMS.txt");
        let candidates = [example("v0.1.0-rc.2"), example("v0.1.0-weekly.20261116"),
            draft, incomplete];
        let status = status_from(&candidates, "0.1.0-rc.2", true).unwrap();
        assert_eq!(status.latest, "v0.1.0-weekly.20261116");
        assert!(status.update_available);
        assert_eq!(status.channel, "weekly");
        assert!(!status_from(&candidates, "0.1.0", true).unwrap().update_available);
        assert!(status_from(&candidates, "0.1.0", false).unwrap().update_available);
        assert!(!status_from(&candidates, "0.2.0", false).unwrap().update_available);
    }

    #[test]
    fn checksum_manifest_rejects_duplicates_and_missing_files() {
        let tag = "v0.1.0-weekly.20261116";
        let names = filenames(tag);
        let valid = names.iter().map(|name| format!("{}  {name}\n", "a".repeat(64)))
            .collect::<String>();
        assert_eq!(checksums(valid.as_bytes(), tag).unwrap().len(), 4);
        assert!(checksums(valid.replace(&names[0], "../evil").as_bytes(), tag).is_err());
        assert!(checksums(valid.lines().next().unwrap().as_bytes(), tag).is_err());
        assert!(checksums(format!("{valid}{}", valid.lines().next().unwrap()).as_bytes(), tag).is_err());
    }
}
