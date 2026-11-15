import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { COMMIT_NOTICES, type CommitNotice } from "@/data/commits.generated";
import { REPO_LINKS } from "@/data/repository";
import { ConsoleIcon } from "./ConsoleIcons";
import { blip } from "./audio";
import { XmbList, type XmbListEntry } from "./XmbList";
import type { ItemIcon } from "./categories";
import { CommitDetail } from "./CommitDetail";
import { useDpadNavigation } from "./useDpadNavigation";

/**
 * The console's Information Board.
 *
 * The hardware keeps a circular information button in the top-right corner;
 * pressing it opens the pending items as a Settings-style list over the
 * waves. The list is the console's own list (XmbList): the selected entry
 * stands on the centre line, enlarged and fully opaque; the entries around
 * it step away, shrink and fade; every entry carries its kind icon, a
 * one-line title (merges read "Merged PR #n" with the branch beneath) and
 * the commit's date and time at the right edge in a fixed tabular column.
 * Unread entries carry a small bright dot that disappears once the cursor
 * selects them; the button's own dot lights only while something is unread,
 * on every screen.
 *
 * New commits announce themselves the way the hardware announces anything:
 * an icon and one line of text, in the menu's own shadow, slide in at the
 * top right, hold for a moment, fade out. Several announcements queue up
 * and play one at a time. The toast never takes focus and never touches
 * the navigation.
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

export const NOTICE_COUNT = VIEWS.length;

export interface NoticeControls {
  activate(index: number): void;
  back(): void;
  step(axis: "up" | "down" | "left" | "right"): void;
}

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
  cursor,
  onCursorChange,
  onOpenChange,
  onBack,
  ref,
  onUnreadCountChange,
}: {
  /** The menu is on screen; a section that opens takes the board with it. */
  active: boolean;
  open: boolean;
  /** The boot sequence has finished; toasts wait for it. */
  booted: boolean;
  /** The keyboard cursor: the entry the list is anchored on. It is owned by
      the shell, so the gamepad can travel the board with the console's own
      verbs. Hovering does not move it — the highlight travels to the hovered
      entry instead, so the rows stay put under the pointer, as in the menu. */
  cursor: number;
  onCursorChange: (index: number) => void;
  onOpenChange: (open: boolean) => void;
  /** Close the board and hand the keyboard back to the last category. */
  onBack: () => void;
  ref?: Ref<NoticeControls>;
  onUnreadCountChange: (count: number) => void;
}) {
  const wasActive = useRef(active);
  const boot = useRef<{ unread: Set<string>; pending: NoticeView[] } | null>(null);
  if (boot.current === null) boot.current = computeBoot();
  const [unread, setUnread] = useState<Set<string>>(() => boot.current!.unread);
  const [queue, setQueue] = useState<NoticeView[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const now = new Date();
  const [detail, setDetail] = useState<CommitNotice | null>(null);
  const detailScroll = useRef<HTMLDivElement>(null);
  const gestures = useDpadNavigation(open && !detail, (axis) => {
    if (axis === "left") { back(); return; }
    if (axis !== "up" && axis !== "down") return;
    onCursorChange(Math.max(0, Math.min(NOTICE_COUNT - 1, cursor + (axis === "down" ? 1 : -1))));
    blip("move");
  });
  useEffect(() => { if (!open) setDetail(null); }, [open]);

  const back = () => {
    blip("back");
    if (detail) setDetail(null);
    else onBack();
  };
  const activate = (index: number) => {
    const view = VIEWS[index];
    if (!view) return;
    if (view.history) { window.open(view.href, "_blank", "noopener,noreferrer"); return; }
    const commit = COMMIT_NOTICES.find((item) => item.sha === view.sha);
    if (!commit) return;
    onCursorChange(index);
    markReadRef.current(view);
    blip("select");
    setDetail(commit);
  };
  useImperativeHandle(ref, () => ({
    activate: (index) => {
      if (detail) {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && focused.closest(".console-commit")) focused.click();
      } else activate(index);
    },
    back,
    step: (axis) => {
      if (axis === "left") { back(); return; }
      if (axis !== "up" && axis !== "down") return;
      if (detail) {
        const targets = Array.from(detailScroll.current?.querySelectorAll<HTMLElement>("summary, a") ?? []);
        const at = targets.indexOf(document.activeElement as HTMLElement);
        const next = targets[Math.max(0, Math.min(targets.length - 1, at + (axis === "down" ? 1 : -1)))];
        next?.focus();
      } else onCursorChange(Math.max(0, Math.min(NOTICE_COUNT - 1, cursor + (axis === "down" ? 1 : -1))));
    },
  }));

  // Opening a section takes the board with it; it can be summoned again.
  useEffect(() => {
    if (wasActive.current && !active) onOpenChange(false);
    wasActive.current = active;
  }, [active, onOpenChange]);

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

  const markRead = (view: NoticeView) => {
    if (view.history || !unread.has(view.sha)) return;
    const next = new Set(unread);
    next.delete(view.sha);
    setUnread(next);
    const state = loadState();
    if (state) saveState({ lastSeen: state.lastSeen, read: COMMIT_NOTICES.map((c) => c.sha).filter((sha) => !next.has(sha)), pending: state.pending });
  };
  const markReadRef = useRef(markRead);
  markReadRef.current = markRead;
  useEffect(() => {
    if (open && VIEWS[cursor]) markReadRef.current(VIEWS[cursor]);
  }, [open, cursor]);

  // Back while the board is open: Esc, Backspace or the left arrow plays the
  // same slide backwards and hands the keyboard to the last category,
  // exactly as on the console.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") || e.key === "/") {
        e.preventDefault(); e.stopPropagation(); return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" || e.key === "Backspace" || e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        back();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onBack, detail]);

  const close = () => {
    blip("back");
    onBack();
  };

  const entries: XmbListEntry[] = VIEWS.map((view) => ({
    key: view.history ? "history" : view.sha,
    icon: view.icon,
    title: view.title,
    sub: view.subtitle,
    meta: view.history ? null : stamp(view.date, now),
    detail: view.history
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
      ),
    fresh: !view.history && unread.has(view.sha),
    ariaLabel: view.history
      ? "Full history on GitHub, opens in a new tab."
      : `${view.title}. ${view.author}, ${view.short}, ${stamp(view.date, now)}.${!view.history && unread.has(view.sha) ? " Unread." : ""}`,
  }));

  const unreadCount = unread.size;
  useEffect(() => { onUnreadCountChange(unreadCount); }, [unreadCount, onUnreadCountChange]);

  return (
    <>

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
        data-detail={!!detail}
        onWheel={gestures.onWheel}
        onTouchStart={gestures.onTouchStart}
        onTouchEnd={gestures.onTouchEnd}
        onTouchCancel={gestures.onTouchCancel}
        onClickCapture={(event) => { if (gestures.suppressClick()) { event.preventDefault(); event.stopPropagation(); } }}
      >
        {/* The section mark: the large icon sits level with the selected
            entry, with the back chevron beside it, as on the hardware. */}
        {detail ? <CommitDetail commit={detail} onBack={back} scrollRef={detailScroll} /> : <>
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

        <XmbList
          entries={entries}
          selected={cursor}
          onSelect={onCursorChange}
          onActivate={activate}
          onHighlight={(index) => { if (open) markReadRef.current(VIEWS[index]); }}
          focusOnMount={open}
          className="console-notice-list"
          ariaLabel="Commit notifications"
        />
        <div className="console-notice-controls" aria-label="Notification navigation">
          <button type="button" aria-label="Previous notification" disabled={cursor === 0} onClick={() => onCursorChange(Math.max(0, cursor - 1))}>↑</button>
          <button type="button" aria-label="Open selected notification" onClick={() => activate(cursor)}>Open</button>
          <button type="button" aria-label="Next notification" disabled={cursor === VIEWS.length - 1} onClick={() => onCursorChange(Math.min(VIEWS.length - 1, cursor + 1))}>↓</button>
        </div>
        </>}
      </aside>
    </>
  );
}
