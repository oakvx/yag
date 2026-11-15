import { useEffect, useMemo, useState } from "react";
import { COMMIT_NOTICES } from "@/data/commits.generated";
import { ConsoleIcon } from "./ConsoleIcons";
import { cleanCommitTitle } from "./commitTitle";
import { useRouter } from "@/router/RouterContext";
import { useGamepadStatus } from "./useGamepad";
import { TROPHIES, useTrophyState } from "./trophies";
import { THEME_NAMES, selectedTheme } from "./palette";

export function XmbStatusBar({
  unreadCount,
  noticesOpen,
  infoDisabled,
  searchDisabled,
  onInfo,
  onSearch,
}: {
  unreadCount: number;
  noticesOpen: boolean;
  infoDisabled: boolean;
  searchDisabled: boolean;
  onInfo: () => void;
  onSearch: () => void;
}) {
  const { navigate } = useRouter();
  const gamepad = useGamepadStatus();
  const trophyState = useTrophyState();
  const [date, setDate] = useState(() => new Date());
  const [newsIndex, setNewsIndex] = useState(0);

  // Live second-accurate clock for pulsing colon & time accuracy
  useEffect(() => {
    const timer = window.setInterval(() => setDate(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const latest = useMemo(
    () => cleanCommitTitle(COMMIT_NOTICES[0]?.subject, COMMIT_NOTICES[0]?.body),
    [],
  );

  const trophyCount = Object.keys(trophyState.unlocked).length;
  const themeIdx = selectedTheme() ?? date.getMonth();
  const themeName = THEME_NAMES[themeIdx] ?? "Original";

  const newsItems = useMemo(
    () => [
      { id: "commit", tag: "UPDATE", text: latest || "YAG Core v2006.11" },
      { id: "gateway", tag: "GATEWAY", text: "YAG Gateway • 16 Model Routes • Localhost 8080" },
      {
        id: "trophy",
        tag: "TROPHY",
        text: `Trophies: ${trophyCount}/${TROPHIES.length} unlocked • Explore to collect`,
      },
      { id: "theme", tag: "THEME", text: `Atmosphere: ${themeName} • WebGL Realtime Wave Active` },
    ],
    [latest, trophyCount, themeName],
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNewsIndex((prev) => (prev + 1) % newsItems.length);
    }, 6000);
    return () => window.clearInterval(interval);
  }, [newsItems.length]);

  const currentNews = newsItems[newsIndex];
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return (
    <section className="console-status" aria-label="Console status">
      {/* Gloss glass sheen reflection across the top */}
      <div className="console-status-gloss" aria-hidden="true" />

      <div className="console-status-row">
        {/* User avatar with PSN Online indicator + notification badge */}
        <button
          type="button"
          className="console-status-user-btn"
          onClick={() => navigate("/profile")}
          title="User Profile & Session (Online)"
          aria-label={`Profile: Online, ${unreadCount} unread notices`}
        >
          <span className="console-user-avatar-wrap">
            <ConsoleIcon name="project" />
            <span className="console-online-dot" title="Online" />
          </span>
          {unreadCount > 0 && (
            <span className="console-unread-badge" aria-hidden="true">
              {unreadCount}
            </span>
          )}
        </button>

        {/* Controller 1 + Battery status */}
        <div
          className="console-status-controller"
          data-connected={gamepad.connected}
          title={
            gamepad.connected
              ? "DualShock 3 (Port 1) Connected • Battery 100%"
              : "Controller Standby (Keyboard / Mouse Active)"
          }
        >
          <svg className="console-controller-glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="2" y="7" width="20" height="11" rx="3.5" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="7" cy="12.5" r="1.3" fill="currentColor" />
            <circle cx="17" cy="12.5" r="1.3" fill="currentColor" />
            <path d="M12 9.5v5m-2.5-2.5h5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
          </svg>
          <span className="console-controller-num">{gamepad.connected ? "1" : "—"}</span>
          <div className="console-battery" aria-hidden="true">
            <span className={gamepad.connected ? "is-filled" : ""} />
            <span className={gamepad.connected ? "is-filled" : ""} />
            <span className={gamepad.connected ? "is-filled" : ""} />
          </div>
        </div>

        {/* Wi-Fi / Network signal indicator */}
        <div
          className="console-status-wifi"
          title="Network Connection: Active • 1000BASE-T / Wi-Fi"
          aria-label="Network Connected"
        >
          <span className="wifi-bar wifi-1" />
          <span className="wifi-bar wifi-2" />
          <span className="wifi-bar wifi-3" />
        </div>

        {/* PS3 Clock with live pulsing colon */}
        <time className="console-clock" dateTime={date.toISOString()}>
          <span className="console-clock-date">{day}/{month}</span>
          <span className="console-clock-time">
            {hours}
            <span className="console-clock-colon">:</span>
            {minutes}
          </span>
        </time>

        {/* Quick jump search button */}
        <button
          className="console-search-toggle"
          data-console-action
          type="button"
          aria-label="Search all destinations"
          title="Search (/ or Ctrl+K)"
          inert={searchDisabled}
          onClick={onSearch}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="m15.5 15.5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {/* Information Board toggle */}
        <button
          type="button"
          className="console-notice-toggle"
          data-console-action
          data-open={noticesOpen}
          disabled={infoDisabled}
          aria-expanded={noticesOpen}
          aria-controls="console-notices"
          aria-label={
            noticesOpen
              ? "Close notifications"
              : unreadCount
              ? `Notifications, ${unreadCount} unread`
              : "Notifications, all read"
          }
          onClick={onInfo}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9.1" stroke="currentColor" strokeWidth="1.5" />
            <path d="M12 10.6v5.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="12" cy="7.4" r="1.05" fill="currentColor" />
          </svg>
          <span className="console-notice-dot" data-on={unreadCount > 0} aria-hidden="true" />
        </button>
      </div>

      {/* Multi-news feed ticker with smooth flip transition */}
      <div className="console-status-ticker" title={currentNews.text}>
        <div key={currentNews.id} className="console-ticker-item">
          <span className="console-ticker-tag">{currentNews.tag}</span>
          <span className="console-ticker-content">{currentNews.text}</span>
        </div>
      </div>
    </section>
  );
}
