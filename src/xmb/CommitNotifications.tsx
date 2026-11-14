import { useEffect, useRef, useState, type CSSProperties } from "react";
import { COMMIT_NOTICES, type CommitNotice } from "@/data/commits.generated";
import { REPO_LINKS } from "@/data/repository";
import { ConsoleIcon } from "./ConsoleIcons";
import { blip } from "./audio";
import type { ItemIcon } from "./categories";

/**
 * The console's Information Board.
 *
 * The hardware keeps a circular information button in the top-right corner;
 * pressing it opens the pending items as a Settings-style list over the
 * waves — the same behaviour as the menu's own lists. The selected entry
 * sits on the console's central axis, enlarged and fully opaque; the entries
 * around it step away, shrink and fade; the list slides with ease-out when
 * the selection moves. Every entry carries its kind icon, a one-line title
 * (merges read "Merged PR #n" with the branch beneath), and the commit's
 * date and time at the right edge in a fixed, tabular column. Unread
 * entries carry a small bright dot that disappears once the cursor selects
 * them; the button's own dot lights only while something is unread, on
 * every screen.
 *
 * New commits announce themselves the way the hardware announces anything:
 * a dark rounded bar slides in at the top right, holds for a moment, fades
 * out. Several announcements queue up and play one at a time. The toast
 * never takes focus and never touches the navigation.
 *
 * The pending items are the repository's own commits: the history that
 * produced this build, read once at build time so the page stays a static
 * document with no runtime calls. Read state survives between visits in
 * localStorage, so "new" means new to this browser.
 */

/** How long a toast stays on screen before it fades out. */
const TOAST_VISIBLE_MS = 5000;
/** How long a toast takes to fade out. */
const TOAST_EXIT_MS = 320;
/** localStorage key; the shape version is embedded so old states are ignored. */
const STORAGE_KEY = "yag.console.notices.v1";

interface NoticeState {
  /** Epoch ms of the last visit; commits newer than this are announcements. */
  lastSeen: number;
  /** Sha of every commit this browser has read. */
  read: string[];
  /** Sha of commits announced but not yet shown as toasts. */
  pending: string[];
}

function loadState(): NoticeState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NoticeState>;
    if (typeof parsed.lastSeen !== "number" || !Array.isArray(parsed.read) || !Array.isArray(parsed.pending)) return null;
    const text = (value: unknown) => (typeof value === "string" ? value : null);
    return {
      lastSeen: parsed.lastSeen,
      read: parsed.read.map(text).filter((value): value is string => value !== null),
      pending: parsed.pending.map(text).filter((value): value is string => value !== null),
    };
  } catch {
    return null;
  }
}

function saveState(state: NoticeState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Storage unavailable (private mode, file://): the board still works, it just forgets. */
  }
}

/** What the board shows for one entry, presented as a notification, not a log line. */
interface NoticeView {
  sha: string;
  title: string;
  /** Small line under the title: the source branch of a merged pull request. */
  subtitle: string | null;
  /** Conventional-commit kind, only when it means something. */
  category: string | null;
  author: string;
  short: string;
  date: string;
  href: string;
  icon: ItemIcon;
  /** The "Full history on GitHub" entry is a link, not a commit. */
  history: boolean;
}

const KIND_ICONS: Record<string, ItemIcon> = {
  feat: "protocol",
  fix: "shield",
  docs: "contribute",
  ci: "monitor",
  test: "status",
  perf: "trace",
  build: "download",
  refactor: "topology",
  chore: "configuration",
  style: "gateway",
  revert: "routing",
  recovery: "connections",
  merge: "source",
};

function iconFor(kind: string): ItemIcon {
  return KIND_ICONS[kind] ?? "information";
}

const MERGE_PULL_REQUEST = /^Merge pull request #(\d+) from (.+)$/;

function viewFor(commit: CommitNotice): NoticeView {
  const pull = MERGE_PULL_REQUEST.exec(commit.subject);
  return {
    sha: commit.sha,
    title: pull ? `Merged PR #${pull[1]}` : commit.subject,
    subtitle: pull ? pull[2] : null,
    // "other" means "no prefix", which says nothing; a merge already says
    // what it is in its title.
    category: commit.kind !== "other" && commit.kind !== "merge" ? commit.kind : null,
    author: commit.author,
    short: commit.short,
    date: commit.date,
    href: `${REPO_LINKS.repo}/commit/${commit.sha}`,
    icon: iconFor(commit.kind),
    history: false,
  };
}

const VIEWS: NoticeView[] = [...COMMIT_NOTICES.map(viewFor), {
  sha: "",
  title: "Full history on GitHub",
  subtitle: null,
  category: null,
  author: "",
  short: "",
  date: "",
  href: `${REPO_LINKS.repo}/commits`,
  icon: "link",
  history: true,
}];

const VIEW_BY_SHA: Map<string, NoticeView> = new Map(COMMIT_NOTICES.map((commit, i) => [commit.sha, VIEWS[i]]));

/** First visit: everything is read except the newest commit — the one that
    produced this build, the only one the console announces on arrival. */
function computeBoot(): { unread: Set<string>; pending: NoticeView[] } {
  const state = loadState();
  if (!state) {
    const newest = COMMIT_NOTICES[0];
    const pending = newest ? [newest.sha] : [];
    saveState({ lastSeen: Date.now(), read: COMMIT_NOTICES.slice(1).map((c) => c.sha), pending });
    return { unread: new Set(pending), pending: pending.map((sha) => VIEW_BY_SHA.get(sha)!).filter(Boolean) };
  }
  const read = new Set(state.read);
  const unseen = COMMIT_NOTICES.filter((c) => !read.has(c.sha));
  // Announcements queued on a previous visit, plus anything newer than that visit.
  const pending = [...new Set([
    ...state.pending,
    ...unseen.filter((c) => new Date(c.date).getTime() > state.lastSeen).map((c) => c.sha),
  ])];
  if (pending.length !== state.pending.length) saveState({ ...state, pending });
  return {
    unread: new Set(unseen.map((c) => c.sha)),
    pending: pending.map((sha) => VIEW_BY_SHA.get(sha)).filter((view): view is NoticeView => view !== undefined),
  };
}

/** The console's clock format: day/month hour:minute, the year only when it differs from today's. */
function stamp(iso: string, now: Date): string {
  const then = new Date(iso);
  if (!Number.isFinite(then.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = then.getFullYear() === now.getFullYear() ? "" : `/${String(then.getFullYear()).slice(-2)}`;
  return `${pad(then.getDate())}/${pad(then.getMonth() + 1)}${year} ${then.getHours()}:${pad(then.getMinutes())}`;
}

interface ToastState {
  view: NoticeView;
  leaving: boolean;
}

export function CommitNotifications({
  active,
  open,
  booted,
  onOpenChange,
  onBack,
}: {
  /** The menu is on screen; a section that opens takes the board with it. */
  active: boolean;
  open: boolean;
  /** The boot sequence has finished; toasts wait for it. */
  booted: boolean;
  onOpenChange: (open: boolean) => void;
  /** Close the board and hand the keyboard back to the last category. */
  onBack: () => void;
}) {
  const toggleRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wasActive = useRef(active);
  // The keyboard cursor: the entry the list is anchored on. Hovering does
  // not move it — the highlight travels to the hovered entry instead, so
  // the rows stay put under the pointer, as in the main menu.
  const [cursor, setCursor] = useState(0);
  const [hover, setHover] = useState<{ anchor: number; index: number } | null>(null);
  const boot = useRef<{ unread: Set<string>; pending: NoticeView[] } | null>(null);
  if (boot.current === null) boot.current = computeBoot();
  const [unread, setUnread] = useState<Set<string>>(() => boot.current!.unread);
  const [queue, setQueue] = useState<NoticeView[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const now = new Date();

  // Opening a section takes the board with it; it can be summoned again.
  useEffect(() => {
    if (wasActive.current && !active) onOpenChange(false);
    wasActive.current = active;
  }, [active, onOpenChange]);

  // Every summoning starts on the newest commit, as the hardware does; the
  // keyboard moves into the list with it, wherever it was opened from.
  useEffect(() => {
    if (!open) return;
    setCursor(0);
    setHover(null);
    const first = listRef.current?.querySelector<HTMLAnchorElement>(".console-notice-link");
    first?.focus({ preventScroll: true });
  }, [open]);

  // Announcements wait for the boot to finish, then queue up and play one
  // at a time. The storage flag keeps the announcement from repeating.
  useEffect(() => {
    if (!booted) return;
    const { pending } = boot.current!;
    if (pending.length === 0) return;
    const state = loadState();
    if (state && state.pending.length > 0) saveState({ ...state, pending: [] });
    setQueue(pending);
  }, [booted]);

  useEffect(() => {
    if (toast || queue.length === 0) return;
    const [head, ...rest] = queue;
    setQueue(rest);
    setToast({ view: head, leaving: false });
  }, [toast, queue]);

  useEffect(() => {
    if (!toast || toast.leaving) return;
    const timer = window.setTimeout(() => setToast((value) => (value ? { ...value, leaving: true } : value)), TOAST_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!toast || !toast.leaving) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // The console's keys, while the board is open: the arrows travel the
  // list, Home and End jump, and Back — Esc, Backspace, the left arrow or
  // the chevron — plays the same slide backwards and hands the keyboard to
  // the last category, exactly as on the console.
  useEffect(() => {
    if (!open) return;
    const back = (e: KeyboardEvent) => {
      e.preventDefault();
      blip("back");
      onBack();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Backspace" || e.key === "ArrowLeft") {
        back(e);
        return;
      }
      if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") {
        e.preventDefault();
        if (e.key === "ArrowRight") return;
        const rows = Array.from(listRef.current?.querySelectorAll<HTMLAnchorElement>(".console-notice-link") ?? []);
        if (rows.length === 0) return;
        const at = rows.indexOf(document.activeElement as HTMLAnchorElement);
        const next = e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : rows.length - 1;
        const clamped = Math.max(0, Math.min(rows.length - 1, next));
        setHover(null);
        setCursor(clamped);
        rows[clamped]?.focus({ preventScroll: true });
        if (at !== clamped) blip("move");
        return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onBack]);

  const toggle = () => {
    blip(open ? "back" : "select");
    onOpenChange(!open);
  };

  const close = () => {
    blip("back");
    onBack();
  };

  const markRead = (view: NoticeView) => {
    if (view.history || !unread.has(view.sha)) return;
    const next = new Set(unread);
    next.delete(view.sha);
    setUnread(next);
    const state = loadState();
    if (state) saveState({ lastSeen: state.lastSeen, read: COMMIT_NOTICES.map((c) => c.sha).filter((sha) => !next.has(sha)), pending: state.pending });
  };

  const highlighted = hover?.index ?? cursor;
  useEffect(() => {
    if (open) markRead(VIEWS[highlighted]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, highlighted]);

  const unreadCount = unread.size;

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
        aria-label={open ? "Close notifications" : unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications, all read"}
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9.1" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 10.6v5.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="7.4" r="1.05" fill="currentColor" />
        </svg>
        <span className="console-notice-dot" data-on={unreadCount > 0} aria-hidden="true" />
      </button>

      {/* New-commit toasts: queued, one at a time, never focusable. */}
      <div className="console-toast-region" aria-live="polite" role="status">
        {toast && (
          <div className="console-toast" data-leaving={toast.leaving || undefined}>
            <span className="console-toast-icon">
              <ConsoleIcon name={toast.view.icon} />
            </span>
            <span className="console-toast-text">{toast.view.title}</span>
          </div>
        )}
      </div>

      <aside
        id="console-notices"
        className="console-notice-panel"
        data-console-action
        data-open={open}
        aria-label="Commit notifications"
        aria-hidden={!open}
        aria-live="polite"
        inert={!open}
      >
        {/* The section mark: the large icon sits level with the selected
            entry, with the back chevron beside it, as on the hardware. */}
        <div className="console-notice-rail">
          <button
            type="button"
            className="console-notice-back"
            aria-label="Back to menu"
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
          {VIEWS.map((view, index) => {
            // While hovering, the rows keep the anchor they had when the
            // pointer arrived; only the highlight moves. Otherwise the
            // cursor entry sits on the anchor line, as on the hardware.
            const anchor = hover?.anchor ?? cursor;
            const offset = index - anchor;
            const on = index === highlighted;
            const distance = Math.abs(index - highlighted);
            // Size and brightness interpolate with the distance from the
            // selection, the way the hardware's list dissolves toward the
            // edges of the screen.
            const scale = distance === 0 ? 1 : Math.max(0.68, 0.85 - distance * 0.06);
            const opacity = distance === 0 ? 1 : Math.max(0.2, 0.8 - distance * 0.16);
            const fresh = !view.history && unread.has(view.sha);
            return (
              <li
                key={view.history ? "history" : view.sha}
                className={on ? "console-notice-item is-selected" : "console-notice-item"}
                style={{ "--notice-offset": offset, "--item-scale": scale, opacity } as CSSProperties}
              >
                <a
                  className="console-notice-link"
                  href={view.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={view.history
                    ? "Full history on GitHub, opens in a new tab."
                    : `${view.title}. ${view.author}, ${view.short}, ${stamp(view.date, now)}.${fresh ? " Unread." : ""}`}
                  aria-current={on ? "true" : undefined}
                  onMouseEnter={() => {
                    setHover((h) => (h ? h : { anchor: cursor, index }));
                    blip("move");
                  }}
                  onFocus={() => { setHover(null); setCursor(index); }}
                >
                  <span className="console-notice-icon" aria-hidden="true">
                    <ConsoleIcon name={view.icon} />
                  </span>
                  <span className="console-notice-body">
                    <span className="console-notice-top">
                      {fresh && <span className="console-notice-new" aria-hidden="true" />}
                      <span className="console-notice-subject">
                        {view.title}
                        {view.subtitle && <span className="console-notice-subtitle">{view.subtitle}</span>}
                      </span>
                      <span className="console-notice-time">{view.history ? "" : stamp(view.date, now)}</span>
                    </span>
                    {on && (
                      <span className="console-notice-detail">
                        {view.history
                          ? "Every commit that produced this build, and the rest."
                          : (
                            <>
                              {view.author}
                              <span aria-hidden="true"> · </span>
                              <span className="console-notice-sha">{view.short}</span>
                              {view.category && (
                                <>
                                  <span aria-hidden="true"> · </span>
                                  {view.category}
                                </>
                              )}
                            </>
                          )}
                      </span>
                    )}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </aside>
    </>
  );
}
