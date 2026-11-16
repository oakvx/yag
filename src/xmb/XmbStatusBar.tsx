import { useEffect, useState } from "react";
import { COMMIT_NOTICES } from "@/data/commits.generated";
import { ConsoleIcon } from "./ConsoleIcons";
import { cleanCommitTitle } from "./commitTitle";
import { useRouter } from "@/router/RouterContext";
import { useRepositoryStats } from "./useRepositoryStats";

const formatCount = (count: number | null) => count === null ? "—"
  : count < 10_000 ? String(count)
  : new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(count);

/** PS3 information-panel order: avatar, friends, messages, date/time, busy icon, news. */
export function XmbStatusBar({ unreadCount, noticesOpen, infoDisabled, onInfo }: {
  unreadCount: number;
  noticesOpen: boolean;
  infoDisabled: boolean;
  onInfo: () => void;
}) {
  const { navigate, phase } = useRouter();
  const { stats, loading } = useRepositoryStats();
  const [date, setDate] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setDate(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const latest = cleanCommitTitle(COMMIT_NOTICES[0]?.subject, COMMIT_NOTICES[0]?.body);
  const updated = stats.updatedAt ? `Last GitHub update: ${new Date(stats.updatedAt).toLocaleString()}` : "GitHub statistics unavailable";
  const commitLabel = stats.commits === null ? "Commit count unavailable" : `${stats.commits} total commits`;
  const friendLabel = stats.watchers === null ? "Friends: GitHub watchers unavailable" : `Friends: ${stats.watchers} GitHub watchers`;
  const noticeLabel = `${noticesOpen ? "Close" : "Open"} notifications, ${commitLabel}, ${unreadCount} unread`;
  const busy = loading || phase !== "idle";

  return (
    <section className="console-status" aria-label="Console status">
      <div className="console-status-row">
        <button type="button" className="console-status-user-btn" data-console-action
          disabled={infoDisabled || noticesOpen} onClick={() => navigate("/profile")}
          title="Local profile" aria-label="Local profile">
          <ConsoleIcon name="project" />
        </button>

        <span className="console-status-friends" role="img" aria-label={friendLabel}
          title={`${friendLabel}. Watchers follow the repository; this is not live presence. ${updated}`}>
          <ConsoleIcon name="connections" />
          <span>{formatCount(stats.watchers)}</span>
        </span>

        <button type="button" className="console-status-commits" data-console-action
          data-unread={unreadCount > 0} data-open={noticesOpen}
          disabled={infoDisabled} onClick={onInfo} aria-expanded={noticesOpen}
          aria-controls="console-notices" aria-label={noticeLabel}
          title={`${commitLabel} on the default branch · ${unreadCount} unread notifications. ${updated}`}>
          <svg viewBox="0 0 24 18" aria-hidden="true" fill="none">
            <rect x="1" y="1" width="22" height="16" rx="1" fill="currentColor" />
            <path d="m2 2 10 8L22 2M2 16l7-7m13 7-7-7" stroke="#303c4a" strokeWidth="1.2" />
          </svg>
          <span>{formatCount(stats.commits)}</span>
        </button>

        <time className="console-clock" dateTime={date.toISOString()}>
          <span className="console-clock-date">{date.getDate()}/{date.getMonth() + 1}</span>
          <span className="console-clock-time">{String(date.getHours()).padStart(2, "0")}:{String(date.getMinutes()).padStart(2, "0")}</span>
        </time>

        <span className="console-status-busy" data-active={busy} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9.3" stroke="currentColor" strokeWidth="1.2" />
            <path d="M12 5v7l-5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      </div>

      <button type="button" className="console-status-ticker" data-console-action
        disabled={infoDisabled} onClick={onInfo} title={latest || "No repository updates"}
        aria-label={`Latest update: ${latest || "No repository updates"}`}>
        <span className="console-ticker-content">{latest || "No repository updates"}</span>
      </button>
    </section>
  );
}
