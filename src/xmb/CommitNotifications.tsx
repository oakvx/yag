import { useEffect, useRef, useState, type CSSProperties } from "react";
import { COMMIT_NOTICES } from "@/data/commits.generated";
import { REPO_LINKS } from "@/data/repository";
import { ConsoleIcon } from "./ConsoleIcons";
import { blip } from "./audio";

/**
 * The console's notification list.
 *
 * Laid out like the hardware's Settings submenu: no panel, just a list
 * floating over the waves. Every entry is a hollow circle and its subject;
 * the selected entry — the one under the cursor — stands larger and brighter,
 * carries its value (how long ago) to the right of the subject and its
 * description (author, short hash, kind) underneath it, the way a setting
 * shows "Off" and its explanation. Entries away from the selection fade
 * with the distance, as they do on the hardware.
 *
 * The pending items are the repository's own commits: the history that
 * produced this build, read once at build time so the page stays a static
 * document with no runtime calls.
 */

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
  /** The menu is on screen; a section that opens takes the list with it. */
  active: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toggleRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wasActive = useRef(active);
  // The keyboard cursor: the entry the list is anchored on. Hovering does
  // not move it — the highlight travels to the hovered entry instead, so
  // the rows stay put under the pointer, as in the main menu.
  const [cursor, setCursor] = useState(0);
  const [hover, setHover] = useState<{ anchor: number; index: number } | null>(null);
  const now = Date.now();

  // Opening a section takes the list with it; it can be summoned again.
  useEffect(() => {
    if (wasActive.current && !active) onOpenChange(false);
    wasActive.current = active;
  }, [active, onOpenChange]);

  // Every summoning starts on the newest commit, as the hardware does.
  useEffect(() => {
    if (open) {
      setCursor(0);
      setHover(null);
    }
  }, [open]);

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
      // The list takes the arrows while it is open; the menu keeps its cursor.
      e.preventDefault();
      const at = rows.indexOf(document.activeElement as HTMLAnchorElement);
      const next = e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : rows.length - 1;
      const clamped = Math.max(0, Math.min(rows.length - 1, next));
      setHover(null);
      setCursor(clamped);
      rows[clamped]?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onOpenChange]);

  const toggle = () => {
    blip(open ? "back" : "select");
    onOpenChange(!open);
  };

  const close = () => {
    blip("back");
    onOpenChange(false);
    toggleRef.current?.focus({ preventScroll: true });
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
        {/* The section mark: the large icon sits level with the selected
            entry, with the back chevron beside it, as on the hardware. */}
        <div className="console-notice-rail">
          <button
            type="button"
            className="console-notice-back"
            aria-label="Close notifications"
            tabIndex={open ? 0 : -1}
            onClick={close}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <span className="console-notice-rail-icon">
            <ConsoleIcon name="information" />
          </span>
        </div>

        <ul className="console-notice-list" ref={listRef} onMouseLeave={() => setHover(null)}>
          {COMMIT_NOTICES.map((commit, index) => {
            // While hovering, the rows keep the anchor they had when the
            // pointer arrived; only the highlight moves. Otherwise the
            // cursor entry sits on the anchor line, as on the hardware.
            const anchor = hover?.anchor ?? cursor;
            const highlighted = hover?.index ?? cursor;
            const offset = index - anchor;
            const on = index === highlighted;
            const distance = Math.abs(index - highlighted);
            // Entries fade with their distance from the selection, the way
            // the hardware's list dissolves toward the edges of the screen.
            const opacity = on ? 1 : Math.max(0.16, 0.78 - distance * 0.17);
            return (
              <li
                key={commit.sha}
                className={on ? "console-notice-item is-selected" : "console-notice-item"}
                data-fresh={index === 0 ? "true" : undefined}
                style={{ "--notice-offset": offset, opacity } as CSSProperties}
              >
                <a
                  className="console-notice-link"
                  href={`${REPO_LINKS.repo}/commit/${commit.sha}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`${commit.subject}. ${commit.author}, ${commit.short}, ${elapsed(commit.date, now)} ago.`}
                  aria-current={on ? "true" : undefined}
                  onMouseEnter={() => setHover((h) => ({ anchor: h?.anchor ?? cursor, index }))}
                  onFocus={() => { setHover(null); setCursor(index); }}
                >
                  <span className="console-notice-bullet" aria-hidden="true" />
                  <span className="console-notice-body">
                    <span className="console-notice-top">
                      <span className="console-notice-subject">{commit.subject}</span>
                      <span className="console-notice-value">{elapsed(commit.date, now)}</span>
                    </span>
                    {on && (
                      <span className="console-notice-detail">
                        {commit.author} · <span className="console-notice-sha">{commit.short}</span> · {commit.kind}
                      </span>
                    )}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>

        <footer className="console-notice-foot">
          <a href={`${REPO_LINKS.repo}/commits`} target="_blank" rel="noreferrer noopener">
            Full history on GitHub ↗
          </a>
        </footer>
      </aside>
    </>
  );
}
