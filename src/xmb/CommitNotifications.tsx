import { useEffect, useRef } from "react";
import { COMMIT_NOTICES } from "@/data/commits.generated";
import { REPO_LINKS } from "@/data/repository";
import type { GlyphName, ItemIcon } from "./categories";
import { ConsoleIcon } from "./ConsoleIcons";
import { blip } from "./audio";

/**
 * The console's notification column.
 *
 * On the hardware the XMB keeps a circular information button in the top right
 * corner; pressing it slides a column of pending notifications in from the
 * right edge. Here the pending items are the repository's own commits: the
 * history that produced this build, read once at build time so the page stays
 * a static document with no runtime calls.
 */

/** The mark that describes a commit in the column. */
const MARKS: Record<string, GlyphName | ItemIcon> = {
  feat: "protocols",
  fix: "shield",
  docs: "contribute",
  ci: "operations",
  test: "status",
  perf: "trace",
  build: "download",
  merge: "source",
  chore: "monitor",
  revert: "configuration",
  other: "gateway",
};

/** Console time, the way the hardware abbreviates it. */
function elapsed(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} mo`;
  return `${Math.round(months / 12)} y`;
}

export function CommitNotifications({
  active,
  open,
  onOpenChange,
}: {
  /** The menu is on screen; a section that opens takes the column with it. */
  active: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toggleRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wasActive = useRef(active);
  const now = Date.now();

  // Opening a section takes the column with it; it can be summoned again.
  useEffect(() => {
    if (wasActive.current && !active) onOpenChange(false);
    wasActive.current = active;
  }, [active, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
        toggleRef.current?.focus({ preventScroll: true });
        return;
      }
      if (!e.key.startsWith("Arrow") && e.key !== "Home" && e.key !== "End") return;
      const rows = Array.from(listRef.current?.querySelectorAll<HTMLAnchorElement>(".console-notice-link") ?? []);
      if (rows.length === 0) return;
      // The column takes the arrows while it is open; the menu keeps its cursor.
      e.preventDefault();
      const at = rows.indexOf(document.activeElement as HTMLAnchorElement);
      const next = e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : rows.length - 1;
      rows[Math.max(0, Math.min(rows.length - 1, next))]?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const toggle = () => {
    blip(open ? "back" : "select");
    onOpenChange(!open);
  };

  const count = COMMIT_NOTICES.length;

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="console-notice-toggle"
        data-console-action
        data-open={open}
        aria-expanded={open}
        aria-controls="console-notices"
        aria-label={open ? "Close notifications" : `Notifications, ${count} commits`}
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9.1" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 10.6v5.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="7.4" r="1.05" fill="currentColor" />
        </svg>
        {count > 0 && <span className="console-notice-dot" aria-hidden="true" />}
      </button>

      <aside
        id="console-notices"
        className="console-notice-panel"
        data-console-action
        data-open={open}
        aria-label="Commit notifications"
        aria-hidden={!open}
        inert={!open}
      >
        <header className="console-notice-head">
          <span className="console-notice-title">Notifications</span>
          <span className="console-notice-count">{count} commits</span>
        </header>
        <ul className="console-notice-list" ref={listRef}>
          {COMMIT_NOTICES.map((commit, index) => (
            <li key={commit.sha} className="console-notice-item" data-fresh={index === 0 ? "true" : undefined}>
              <a
                className="console-notice-link"
                href={`${REPO_LINKS.repo}/commit/${commit.sha}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                <span className="console-notice-mark" aria-hidden="true">
                  <ConsoleIcon name={MARKS[commit.kind] ?? "gateway"} tone="current" />
                </span>
                <span className="console-notice-body">
                  <span className="console-notice-subject">{commit.subject}</span>
                  <span className="console-notice-meta">
                    <span className="console-notice-sha">{commit.short}</span>
                    <span>{commit.author}</span>
                    <span>{elapsed(commit.date, now)}</span>
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
        <footer className="console-notice-foot">
          <a href={`${REPO_LINKS.repo}/commits`} target="_blank" rel="noreferrer noopener">
            Full history on GitHub
          </a>
        </footer>
      </aside>
    </>
  );
}
