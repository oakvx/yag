import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "@/router/RouterContext";
import { cn } from "@/utils/cn";
import { CATEGORIES, itemTarget, locate, type XmbItem } from "./categories";
import { ConsoleIcon } from "./ConsoleIcons";
import { QuickJump } from "./QuickJump";
import { emitWave, RibbonWallpaper } from "./RibbonWallpaper";
import { blip, xmbAudio } from "./audio";
import { AudioControls } from "./AudioControls";
import { useBrandFont } from "./brandFont";
import { BootScreen, useBootSequence } from "./BootScreen";
import { EasterEgg, useEasterEgg } from "./EasterEgg";
import { CommitNotifications, type NoticeControls } from "./CommitNotifications";
import { useGamepad } from "./useGamepad";
import { ConfirmDialog } from "./ConfirmDialog";
import { TrophyToast } from "./TrophyToast";
import { recordVisit, unlockTrophy } from "./trophies";
import { useDpadNavigation, type DpadDirection } from "./useDpadNavigation";
import { XmbStatusBar } from "./XmbStatusBar";
import { useIdleChrome } from "./useIdleChrome";
import { ScrollEdges } from "@/components/XmbScreen";
import { CardPageInfoContext } from "@/components/CardPage";
import { ApplicationHints, sendApplicationInput } from "./ApplicationControls";
import { ParticleBurst, emitBurst } from "./ParticleBurst";
import { ShutdownOverlay, useShutdown } from "./ShutdownScreen";

/* Pointer sensitivity: one deliberate input = one step, as with the PS3 D-pad. */
/** px the pointer must travel over the same category/item before hover selects it. */
const HOVER_TRAVEL = 14;
/** ms that must pass since the last selection change (≈ slide animation) before hover selects. */
const HOVER_SETTLE = 230;

function DirectionGlyph({ direction }: { direction: DpadDirection }) {
  const rotation = { left: 0, up: 90, right: 180, down: 270 }[direction];
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none"><path d="m14.5 6-6 6 6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" transform={`rotate(${rotation} 12 12)`} /></svg>;
}

function ControllerGlyph({ kind }: { kind: "select" | "back" | "options" | "circle" }) {
  return (
    <svg viewBox="0 0 24 24" className="controller-glyph" aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.2" />
      {kind === "select" ? (
        <path d="M8.8 8.8l6.4 6.4m0-6.4-6.4 6.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      ) : kind === "circle" ? (
        <circle cx="12" cy="12" r="4.3" stroke="currentColor" strokeWidth="1.3" />
      ) : kind === "back" ? (
        <path d="m14.6 7.6-4.8 4.4 4.8 4.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M12 8.4l3.7 6.4H8.3z" fill="currentColor" stroke="currentColor" strokeWidth="0.7" strokeLinejoin="round" />
      )}
    </svg>
  );
}


export function ConsoleEnvironment({ children }: { children: ReactNode }) {
  const {
    surface, journey, phase, path, query, menuCursor, chooseMenu, returnToMenu,
    navigate, paletteOpen, setPaletteOpen, route,
  } = useRouter();
  const [direction, setDirection] = useState<"right" | "left">("right");
  const [screenTitle, setScreenTitle] = useState("");
  const [pageInfo, setPageInfo] = useState("");
  useLayoutEffect(() => {
    const title = (event: Event) => setScreenTitle((event as CustomEvent<string>).detail);
    window.addEventListener("yag:screen-title", title);
    return () => window.removeEventListener("yag:screen-title", title);
  }, []);
  const boot = useBootSequence();
  const shutdown = useShutdown();
  const [unreadCount, setUnreadCount] = useState(0);
  const [easterOpen, setEasterOpen] = useState(false);
  const [noticesOpen, setNoticesOpenState] = useState(false);
  const noticeReturnFocus = useRef<HTMLElement | null>(null);
  const setNoticesOpen = useCallback((open: boolean) => {
    if (open && document.activeElement instanceof HTMLElement && !document.activeElement.closest("#console-notices")) {
      noticeReturnFocus.current = document.activeElement;
    }
    setNoticesOpenState(open);
  }, []);
  /** The information board's cursor, owned here so the gamepad can travel it. */
  const [noticeCursor, setNoticeCursor] = useState(0);
  const noticeControls = useRef<NoticeControls>(null);
  /** The △ options panel on the selected destination. */
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [optionIndex, setOptionIndex] = useState(0);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  /** The confirmation dialog shown before leaving for an external site. */
  const [dialog, setDialog] = useState<{ title: string; message: string; run: () => void } | null>(null);
  const [dialogChoice, setDialogChoice] = useState<0 | 1>(0);
  const dialogRef = useRef(dialog);
  const dialogChoiceRef = useRef(dialogChoice);
  const dialogReturnFocus = useRef<HTMLElement | null>(null);
  dialogRef.current = dialog;
  dialogChoiceRef.current = dialogChoice;
  useEffect(() => {
    if (dialog !== null) return;
    const opener = dialogReturnFocus.current;
    if (!opener) return;
    const target = opener.isConnected && !opener.closest("[inert]") ? opener
      : surface === "app" ? appRef.current : itemRefs.current[cursorRef.current.item];
    target?.focus({ preventScroll: true });
    dialogReturnFocus.current = null;
  }, [dialog, surface]);
  const brandFont = useBrandFont();
  const wordmarkTaps = useRef(0);
  const memory = useRef(CATEGORIES.map(() => 0));
  const cursorRef = useRef(menuCursor);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const categoryRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLElement>(null);
  const focusAfterMove = useRef(false);
  const lastChange = useRef(0);
  const hoverIntent = useRef({ key: "", travel: 0, timer: 0 });
  cursorRef.current = menuCursor;
  memory.current[menuCursor.cat] = menuCursor.item;

  const category = CATEGORIES[menuCursor.cat];
  const selected = category.items[menuCursor.item];
  const appLocation = locate(path, query);
  const appCategory = CATEGORIES[appLocation.cat];
  const appItem = appCategory.items[appLocation.item];
  const isApp = surface === "app";
  const isLaunching = journey === "launch" && phase === "cover";
  const isReturning = journey === "return" && phase === "reveal" && !isApp;
  const isShuttingDown = shutdown.phase !== "idle";
  const bootReady = boot.stage === "home" && !isShuttingDown;
  const chrome = useIdleChrome(bootReady && !noticesOpen && !paletteOpen && !optionsOpen && !dialog && !easterOpen);
  const openEaster = useCallback(() => {
    if (!bootReady) return;
    unlockTrophy("service");
    setEasterOpen(true);
    emitWave(menuCursor.cat, 0.9);
    blip("trophy");
  }, [bootReady, menuCursor.cat]);
  useEasterEgg(openEaster);
  // Trophies earned by simply being here.
  useEffect(() => { if (bootReady) unlockTrophy("boot"); }, [bootReady]);
  useEffect(() => {
    if (!bootReady || !isApp) return;
    unlockTrophy("opener");
    recordVisit(path);
  }, [bootReady, isApp, path]);
  useEffect(() => { if (noticesOpen) unlockTrophy("board"); }, [noticesOpen]);
  useEffect(() => { if (paletteOpen && bootReady) unlockTrophy("jump"); }, [paletteOpen, bootReady]);
  const fileOrigin = useRef(menuCursor);
  const fileWasApp = useRef(isApp);
  // The board temporarily owns the screen, whether opened from the menu or
  // a document. Restore its opener without changing the route or scroll.
  const noticesWereOpen = useRef(false);
  const handleNoticesBack = useCallback(() => {
    setNoticesOpen(false);
  }, [setNoticesOpen]);
  useEffect(() => {
    const wasOpen = noticesWereOpen.current;
    noticesWereOpen.current = noticesOpen;
    if (!noticesOpen && wasOpen) {
      const opener = noticeReturnFocus.current;
      const target = opener?.isConnected && !opener.closest("[inert]")
        ? opener : isApp ? appRef.current : categoryRefs.current[CATEGORIES.length - 1];
      target?.focus({ preventScroll: true });
      noticeReturnFocus.current = null;
    }
  }, [noticesOpen, isApp]);

  useEffect(() => { emitWave(menuCursor.cat, 0.22); }, [menuCursor.cat]);
  useEffect(() => { xmbAudio.setInApp(isApp); }, [isApp]);
  useEffect(() => {
    // Hash navigation on file:// creates history entries without the SPA's state.
    if (window.location.protocol === "file:") {
      if (isApp && !fileWasApp.current) fileOrigin.current = cursorRef.current;
      if (!isApp && fileWasApp.current) chooseMenu(fileOrigin.current);
    }
    fileWasApp.current = isApp;
  }, [chooseMenu, isApp]);

  const selectCategory = useCallback((index: number) => {
    const current = cursorRef.current;
    const cat = Math.max(0, Math.min(CATEGORIES.length - 1, index));
    if (cat === current.cat) return;
    setDirection(cat > current.cat ? "right" : "left");
    const next = { cat, item: memory.current[cat] ?? 0 };
    cursorRef.current = next;
    lastChange.current = performance.now();
    chooseMenu(next);
    blip("category");
  }, [chooseMenu]);

  const selectItem = useCallback((index: number) => {
    const current = cursorRef.current;
    const item = Math.max(0, Math.min(CATEGORIES[current.cat].items.length - 1, index));
    if (item === current.item) return;
    const next = { cat: current.cat, item };
    cursorRef.current = next;
    lastChange.current = performance.now();
    chooseMenu(next);
    blip("move");
  }, [chooseMenu]);

  const resetHover = useCallback(() => {
    window.clearTimeout(hoverIntent.current.timer);
    hoverIntent.current = { key: "", travel: 0, timer: 0 };
  }, []);
  useEffect(() => () => window.clearTimeout(hoverIntent.current.timer), []);

  /** Hover intent: enough travel on one target, and the previous slide has settled. */
  const hoverMove = (e: MouseEvent<HTMLElement>, key: string, commit: () => void) => {
    const h = hoverIntent.current;
    if (h.key !== key) {
      window.clearTimeout(h.timer);
      h.key = key; h.travel = 0; h.timer = 0;
    }
    h.travel += Math.hypot(e.movementX, e.movementY);
    if (h.travel < HOVER_TRAVEL || h.timer) return;
    const wait = HOVER_SETTLE - (performance.now() - lastChange.current);
    if (wait <= 0) { h.travel = 0; commit(); return; }
    // Pointer rests on the target before the slide settled: select once it has.
    h.timer = window.setTimeout(() => {
      h.timer = 0;
      if (hoverIntent.current === h && h.key === key) { h.travel = 0; commit(); }
    }, wait);
  };

  const askExternal = useCallback((href: string, label: string) => {
    dialogReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDialogChoice(0);
    setDialog({
      title: "Leave YAG?",
      message: `${label} will open in a new browser tab.`,
      run: () => { window.open(href, "_blank", "noopener,noreferrer"); },
    });
  }, []);
  const resolveDialog = useCallback((confirm: boolean) => {
    const current = dialogRef.current;
    setDialog(null);
    blip(confirm ? "select" : "back");
    if (confirm) current?.run();
  }, []);
  const activate = useCallback((item: XmbItem, coords?: { x: number; y: number }) => {
    blip("select");
    if (coords) {
      emitBurst(coords.x, coords.y);
    } else {
      const icon = itemRefs.current[cursorRef.current.item];
      if (icon) {
        const rect = icon.getBoundingClientRect();
        emitBurst(rect.left + rect.width * 0.15, rect.top + rect.height * 0.5);
      }
    }
    const target = itemTarget(item);
    if (target) navigate(target);
    else if (item.href) askExternal(item.href, item.sub);
  }, [askExternal, navigate]);

  const back = useCallback(() => { blip("back"); returnToMenu(); }, [returnToMenu]);

  // The △ options panel, the way the hardware's: a small list of actions
  // anchored at the right edge, on the selected destination only.
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");
  const copyTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  const shareUrl = (item: XmbItem): string => {
    // The router reads the hash, so "#/path?query" is the shareable form.
    const base = window.location.href.split("#")[0];
    const query = item.query ? `?${new URLSearchParams(item.query).toString()}` : "";
    return `${base}#/${item.to}${query}`;
  };
  const copyLink = async (item: XmbItem) => {
    const url = item.href ?? shareUrl(item);
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      try {
        const area = document.createElement("textarea");
        area.value = url;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        ok = document.execCommand("copy");
        area.remove();
      } catch {
        ok = false;
      }
    }
    if (ok) unlockTrophy("courier");
    setCopyState(ok ? "done" : "failed");
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyState("idle"), 2000);
  };
  const toggleOptions = useCallback(() => {
    setOptionsOpen((open) => {
      setOptionIndex(0);
      blip(open ? "back" : "select");
      if (!open) unlockTrophy("options");
      return !open;
    });
  }, []);

  const closeOptions = useCallback(() => {
    setOptionsOpen(false);
    setOptionIndex(0);
    blip("back");
  }, []);
  const optionsWereOpen = useRef(false);
  useEffect(() => {
    if (optionsWereOpen.current && !optionsOpen && !isApp && !noticesOpen && !dialog) {
      itemRefs.current[cursorRef.current.item]?.focus({ preventScroll: true });
    }
    optionsWereOpen.current = optionsOpen;
  }, [optionsOpen, isApp, noticesOpen, dialog]);

  useEffect(() => {
    if (!optionsOpen) return;
    const timer = window.setTimeout(() => optionRefs.current[0]?.focus({ preventScroll: true }), 30);
    return () => window.clearTimeout(timer);
  }, [optionsOpen]);

  // ○/Esc close the panel on a capture listener, so the menu's own back
  // handling does not run behind it.
  useEffect(() => {
    if (!optionsOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (dialog || !["Escape", "Backspace", "t", "T"].includes(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      closeOptions();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [optionsOpen, closeOptions, dialog]);

  // Navigating into a page dismisses the destination's options.
  useEffect(() => {
    setOptionsOpen(false);
    setOptionIndex(0);
  }, [surface, path]);

  const optionActions = [
    {
      id: "open",
      label: "Open",
      icon: "monitor" as const,
      run: () => {
        blip("select");
        const target = itemTarget(selected);
        if (target) navigate(target);
        else if (selected.href) askExternal(selected.href, selected.sub);
      },
    },
    {
      id: "tab",
      label: "Open in a new tab",
      icon: "link" as const,
      run: () => {
        if (selected.href) askExternal(selected.href, selected.sub);
        else window.open(shareUrl(selected), "_blank", "noopener,noreferrer");
      },
    },
    {
      id: "copy",
      label: "Copy link",
      icon: "download" as const,
      run: () => { void copyLink(selected); },
    },
    {
      id: "info",
      label: "Information",
      icon: "information" as const,
      run: () => { /* the row itself shows the destination's description */ },
    },
  ];

  const onOptionsKey = (e: KeyboardEvent<HTMLUListElement>) => {
    e.stopPropagation();
    const move = (delta: number) => {
      e.preventDefault();
      const next = Math.max(0, Math.min(optionActions.length - 1, optionIndex + delta));
      setOptionIndex(next);
      optionRefs.current[next]?.focus({ preventScroll: true });
      blip("move");
    };
    if (e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if (e.key === "Home" || e.key === "End") move(e.key === "Home" ? -optionActions.length : optionActions.length);
    else if (e.key === "Tab") {
      e.preventDefault();
      const next = (optionIndex + (e.shiftKey ? -1 : 1) + optionActions.length) % optionActions.length;
      setOptionIndex(next);
      optionRefs.current[next]?.focus({ preventScroll: true });
    }
    else if (e.key === "ArrowLeft") { e.preventDefault(); closeOptions(); }
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const action = optionActions[optionIndex];
      if (action.id === "info") return;
      setOptionsOpen(false);
      setOptionIndex(0);
      action.run();
    }
  };

  const stepMenu = (axis: DpadDirection) => {
    resetHover();
    const c = cursorRef.current;
    if (axis === "up" || axis === "down") selectItem(c.item + (axis === "down" ? 1 : -1));
    else if (axis === "right" && c.cat === CATEGORIES.length - 1) { setNoticesOpen(true); blip("category"); }
    else selectCategory(c.cat + (axis === "right" ? 1 : -1));
  };
  const gestures = useDpadNavigation(bootReady && !isApp && !noticesOpen && !optionsOpen && !paletteOpen && !dialog && phase !== "cover", stepMenu);

  // The controller: the same verbs as the keyboard, one input = one step.
  useGamepad({
    onInput: chrome.wake,
    enabled: () => bootReady && !paletteOpen && !easterOpen,
    onStep: (axis, source) => {
      unlockTrophy("handson");
      if (dialogRef.current) {
        if (axis === "left" || axis === "right") { setDialogChoice((c) => (c === 0 ? 1 : 0)); blip("move"); }
        return;
      }
      if (phase === "cover") return;
      if (noticesOpen) {
        noticeControls.current?.step(axis);
        return;
      }
      if (optionsOpen) {
        if (axis === "left") closeOptions();
        else if (axis === "up" || axis === "down") {
          const next = Math.max(0, Math.min(optionActions.length - 1, optionIndex + (axis === "down" ? 1 : -1)));
          setOptionIndex(next);
          optionRefs.current[next]?.focus({ preventScroll: true });
        }
        return;
      }
      if (isApp) {
        sendApplicationInput(appRef.current, source === "shoulder" ? axis === "left" ? "PageUp" : "PageDown"
          : axis === "up" ? "ArrowUp" : axis === "down" ? "ArrowDown" : axis === "left" ? "ArrowLeft" : "ArrowRight");
        return;
      }
      const c = cursorRef.current;
      if (axis === "up") selectItem(c.item - 1);
      else if (axis === "down") selectItem(c.item + 1);
      else if (axis === "right") {
        if (c.cat === CATEGORIES.length - 1) {
          setOptionsOpen(false);
          setOptionIndex(0);
          setNoticesOpen(true);
          blip("category");
        } else {
          selectCategory(c.cat + 1);
        }
      } else if (axis === "left") selectCategory(c.cat - 1);
    },
    onSelect: () => {
      unlockTrophy("handson");
      if (dialogRef.current) { resolveDialog(dialogChoiceRef.current === 0); return; }
      if (phase === "cover") return;
      if (noticesOpen) {
        noticeControls.current?.activate(noticeCursor);
        return;
      }
      if (optionsOpen) {
        const action = optionActions[optionIndex];
        if (action.id !== "info") { setOptionsOpen(false); action.run(); }
        return;
      }
      if (isApp) { sendApplicationInput(appRef.current, "Enter"); return; }
      const c = cursorRef.current;
      activate(CATEGORIES[c.cat].items[c.item]);
    },
    onBack: () => {
      if (dialogRef.current) { resolveDialog(false); return; }
      if (optionsOpen) { closeOptions(); return; }
      if (noticesOpen) {
        noticeControls.current?.back();
        return;
      }
      if (isApp && sendApplicationInput(appRef.current, "Escape") !== false) back();
    },
    onOptions: () => {
      if (dialogRef.current) return;
      if (noticesOpen || isApp || phase === "cover") return;
      toggleOptions();
    },
  });

  useEffect(() => {
    if (focusAfterMove.current) {
      itemRefs.current[menuCursor.item]?.focus({ preventScroll: true });
      focusAfterMove.current = false;
    }
  }, [menuCursor]);

  useEffect(() => {
    if (!bootReady) return;
    if (surface === "menu") {
      const timer = window.setTimeout(() => menuRef.current?.focus({ preventScroll: true }), 30);
      return () => window.clearTimeout(timer);
    }
    appRef.current?.scrollTo({ top: 0 });
    appRef.current?.focus({ preventScroll: true });
  }, [surface, path, bootReady]);

  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      if (!bootReady || paletteOpen || dialogRef.current || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const editing = el && (el.matches("input, textarea, select") || el.isContentEditable);
      if (editing && e.key !== "Escape") return;
      if (noticesOpen || optionsOpen || easterOpen) return;
      if (isApp) {
        if (e.key === "Escape" || e.key === "Backspace") {
          e.preventDefault();
          back();
          return;
        }
        if (e.defaultPrevented) return;
        return;
      }
      if (e.defaultPrevented) return;
      if (phase === "cover") return;
      if (el?.closest("[data-console-action]") && (e.key === "Enter" || e.key === " ")) return;
      if (el?.closest("[data-console-action]") && e.key.startsWith("Arrow")) menuRef.current?.focus();
      if (e.key === "t" || e.key === "T") {
        // The △ button, on the keyboard. The board has no options of its own.
        if (noticesOpen) return;
        e.preventDefault();
        toggleOptions();
        return;
      }
      const c = cursorRef.current;
      if (e.key.startsWith("Arrow")) resetHover();
      switch (e.key) {
        case "ArrowRight":
        case "ArrowLeft": {
          e.preventDefault();
          const step = e.key === "ArrowRight" ? 1 : -1;
          if (step > 0 && c.cat === CATEGORIES.length - 1 && !noticesOpen) {
            // One step past the last category is the information board, as on the console.
            setOptionsOpen(false);
            setOptionIndex(0);
            setNoticesOpen(true);
            blip("category");
            break;
          }
          focusAfterMove.current = el?.hasAttribute("data-console-item") ?? false;
          selectCategory(c.cat + step);
          if (el?.hasAttribute("data-console-category")) categoryRefs.current[cursorRef.current.cat]?.focus({ preventScroll: true });
          break;
        }
        case "ArrowDown":
        case "ArrowUp":
          e.preventDefault();
          focusAfterMove.current = el?.hasAttribute("data-console-item") ?? false;
          selectItem(c.item + (e.key === "ArrowDown" ? 1 : -1));
          itemRefs.current[cursorRef.current.item]?.focus({ preventScroll: true });
          break;
        case "Home":
        case "End":
          e.preventDefault();
          resetHover();
          focusAfterMove.current = el?.hasAttribute("data-console-item") ?? false;
          selectItem(e.key === "Home" ? 0 : CATEGORIES[c.cat].items.length - 1);
          itemRefs.current[cursorRef.current.item]?.focus({ preventScroll: true });
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          activate(CATEGORIES[c.cat].items[c.item]);
          break;
        case "Escape":
        case "Backspace":
          e.preventDefault();
          categoryRefs.current[c.cat]?.focus({ preventScroll: true });
          break;
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [activate, back, bootReady, isApp, noticesOpen, optionsOpen, easterOpen, paletteOpen, phase, resetHover, selectCategory, selectItem, toggleOptions]);

  const onItemClick = (e: MouseEvent<HTMLAnchorElement>, item: XmbItem) => {
    if (gestures.suppressClick()) { e.preventDefault(); return; }
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    activate(item, { x: e.clientX, y: e.clientY });
  };

  const selectionStyle = { "--selected-category": menuCursor.cat } as CSSProperties;
  const viewNames: Record<string, string> = {
    system: "System Information", configuration: "Configuration", operations: "Operations",
    quickstart: "Quickstart", contributing: "Contributing",
  };
  const appTitle = viewNames[query.view] ?? route.label;
  const listAnchor = menuCursor.item;

  return (
    <div className="console-environment" data-surface={surface} data-phase={phase} data-journey={journey} data-boot={boot.stage} data-shutdown={shutdown.phase === "fading" ? "active" : shutdown.phase === "closing" ? "closing" : undefined} data-skipping={boot.skipping} data-notices={noticesOpen ? "open" : "closed"} data-hints-idle={chrome.idle} data-input-mode={chrome.keyboardMode ? "keyboard" : "pointer"}>
      <RibbonWallpaper clock={boot.clock} dimmed={isApp && !noticesOpen} />
      <XmbStatusBar unreadCount={unreadCount} noticesOpen={noticesOpen} infoDisabled={paletteOpen || optionsOpen || dialog !== null || !bootReady} searchDisabled={noticesOpen || optionsOpen || paletteOpen || !bootReady || dialog !== null}
        onInfo={() => { blip(noticesOpen ? "back" : "select"); setNoticesOpen(!noticesOpen); }} onSearch={() => setPaletteOpen(true)} />
      <CommitNotifications ref={noticeControls} onUnreadCountChange={setUnreadCount} active={!isApp} open={noticesOpen} booted={bootReady} cursor={noticeCursor} onCursorChange={setNoticeCursor} onOpenChange={setNoticesOpen} onBack={handleNoticesBack} />
      <BootScreen stage={boot.stage} paused={boot.paused} skipping={boot.skipping} clock={boot.clock} onStart={boot.start} onSkip={boot.skip} />

      {/* The menu itself is the home screen. No application is mounted underneath. */}
      <div
        ref={menuRef}
        className="console-menu"
        data-hidden={isApp}
        data-opening={isLaunching}
        data-returning={isReturning}
        aria-label="YAG cross media menu"
        role="main"
        aria-hidden={isApp || noticesOpen || !bootReady || undefined}
        inert={isApp || paletteOpen || !bootReady || noticesOpen || optionsOpen || dialog !== null}
        tabIndex={-1}
        onWheel={gestures.onWheel}
        onTouchStart={gestures.onTouchStart}
        onTouchEnd={gestures.onTouchEnd}
        onTouchCancel={gestures.onTouchCancel}
        onClickCapture={(event) => { if (gestures.suppressClick()) { event.preventDefault(); event.stopPropagation(); } }}
      >
        <h1 className="sr-only">YAG Cross Media Menu</h1>

        <nav className="console-crossbar" aria-label="Categories" style={selectionStyle} onMouseLeave={resetHover}>
          <div className="console-category-track" role="toolbar" aria-label="Categories">
            {CATEGORIES.map((cat, i) => {
              const on = i === menuCursor.cat;
              return (
                <button
                  key={cat.id}
                  ref={(node) => { categoryRefs.current[i] = node; }}
                  type="button"
                  data-console-category={cat.id}
                  className={cn("console-category", on && "is-selected")}
                  aria-pressed={on}
                  aria-label={cat.label}
                  tabIndex={on ? 0 : -1}
                  onPointerDown={(e) => { if (e.pointerType === "mouse" && e.button === 0) e.preventDefault(); }}
                  onMouseMove={(e) => hoverMove(e, `cat-${i}`, () => selectCategory(i))}
                  onFocus={() => selectCategory(i)}
                  onClick={() => selectCategory(i)}
                >
                  <span className="console-category-art"><ConsoleIcon name={cat.glyph} /></span>
                  <span className="console-category-label">{cat.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <nav
          key={category.id}
          aria-label={`${category.label} destinations`}
          className={cn("console-destinations", direction === "right" ? "from-right" : "from-left")}
          style={{
            // The first following entry has the console's larger breathing
            // space; the remaining rows share a smaller, footer-fitted step.
            "--item-step": `min(var(--item-step-base), max(44px, calc((84dvh - var(--selected-y) - var(--following-lead)) / ${Math.max(category.items.length - 1, 1)})))`,
          } as CSSProperties}
          onMouseLeave={resetHover}
        >
          <ul>
            {category.items.map((item, i) => {
              const delta = i - listAnchor;
              // Previous entries clear the crossbar using its actual geometry;
              // the footer-fitted row step must not determine that clearance.
              const on = i === menuCursor.item;
              // Size and brightness interpolate with the distance from the
              // selection, the way the hardware's list does: the selected
              // label stands at full size, the entries around it step down
              // and dim, the ones above the crossbar a little more.
              const distance = Math.abs(i - menuCursor.item);
              const scale = distance === 0 ? 1 : Math.max(0.6, 0.8 - distance * 0.035);
              const opacity = distance === 0 ? 1 : Math.max(0.5, 0.65 - distance * 0.025);
              return (
                <li
                  key={item.id}
                  className={cn("console-destination-position", on && "is-selected", delta < 0 && "is-above", delta === -1 && "is-previous")}
                  style={{ "--item-offset": delta, "--item-lift": delta < 0 ? "var(--previous-lift)" : "0px", "--item-lead": delta > 0 ? "var(--following-lead)" : "0px", "--item-scale": scale, opacity } as CSSProperties}
                >
                  <a
                    ref={(node) => { itemRefs.current[i] = node; }}
                    href={itemTarget(item) ?? item.href}
                    target={item.href ? "_blank" : undefined}
                    rel={item.href ? "noreferrer noopener" : undefined}
                    className="console-destination"
                    aria-current={on ? "true" : undefined}
                    data-console-item={item.id}
                    tabIndex={on ? 0 : -1}
                    onPointerDown={(e) => { if (e.pointerType === "mouse" && e.button === 0) e.preventDefault(); }}
                    onFocus={() => selectItem(i)}
                    onClick={(e) => {
                      if (gestures.suppressClick()) { e.preventDefault(); return; }
                      selectItem(i);
                      onItemClick(e, item);
                    }}
                    onContextMenu={(e) => {
                      // Right-click on the destination: the △ panel.
                      e.preventDefault();
                      selectItem(i);
                      toggleOptions();
                    }}
                  >
                    <span className="console-item-art"><ConsoleIcon name={item.icon} /></span>
                    {/* The destination stands in a column: the label, with the
                        description beneath it, smaller and without a box. */}
                    <span className="console-destination-body">
                      <span className="console-item-label">{item.label}{item.href && <span className="console-external">↗</span>}</span>
                      <span className="console-item-subtitle">{item.code}</span>
                      {on && <span className="console-description">{item.sub}</span>}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {/* The △ options panel: a small list anchored at the right edge, on
          the selected destination only. */}
      {!isApp && (
        <>
        {optionsOpen && <button type="button" className="console-options-dismiss" aria-label="Close options" onClick={closeOptions} tabIndex={-1} />}
        <div
          role="dialog"
          aria-modal={optionsOpen || undefined}
          aria-label={`Options for ${selected.label}`}
          className="console-options"
          data-open={optionsOpen}
          aria-hidden={!optionsOpen || undefined}
          inert={!optionsOpen || dialog !== null}
        >
          <ul aria-label={`Options, ${selected.label}`} onKeyDown={onOptionsKey}>
            {optionActions.map((action, i) => (
              <li key={action.id}>
                <button
                  ref={(node) => { optionRefs.current[i] = node; }}
                  type="button"
                  className={cn("console-option", i === optionIndex && "is-selected")}
                  tabIndex={optionsOpen && i === optionIndex ? 0 : -1}
                  onClick={() => {
                    if (action.id === "info") return;
                    setOptionsOpen(false);
                    setOptionIndex(0);
                    action.run();
                  }}
                  onMouseEnter={() => { if (i !== optionIndex) { setOptionIndex(i); blip("move"); } }}
                  onFocus={() => setOptionIndex(i)}
                >
                  <span className="console-option-icon" aria-hidden="true"><ConsoleIcon name={action.icon} /></span>
                  <span className="console-option-label">
                    {action.id === "copy" && copyState !== "idle"
                      ? (copyState === "done" ? "Copied" : "Copy failed")
                      : action.label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {optionIndex === optionActions.length - 1 && (
            <p className="console-options-detail">{selected.detail}</p>
          )}
        </div>
        </>
      )}

      {isApp && (
        <section
          className={cn("console-application", phase === "cover" && "is-leaving")}
          data-testid="console-application"
          aria-label={appTitle}
          aria-hidden={noticesOpen || !bootReady || undefined}
          inert={noticesOpen || paletteOpen || !bootReady || dialog !== null}
          onClickCapture={(event) => {
            const link = (event.target as Element).closest<HTMLAnchorElement>("a[target='_blank']");
            if (!link) return;
            event.preventDefault(); event.stopPropagation();
            askExternal(link.href, link.textContent?.replace("↗", "").trim() || "This link");
          }}
        >
          <header className="console-application-header">
            <ConsoleIcon name={appItem.icon} className="console-app-icon" />
            <div>
              <p className="console-app-category">{appCategory.label} › {appTitle}</p>
              <h1>{screenTitle || appTitle}</h1>
            </div>
          </header>
          <CardPageInfoContext.Provider value={setPageInfo}>
            <div className="console-app-body">
              <main ref={appRef} id="main-content" tabIndex={-1} className="console-application-content @container">
                <div key={path} className="console-app-content-enter">{children}</div>
              </main>
              <ScrollEdges targetRef={appRef} />
            </div>
            <ApplicationHints rootRef={appRef} onBack={() => { if (sendApplicationInput(appRef.current, "Escape") !== false) back(); }} backGlyph={<ControllerGlyph kind="circle" />} selectGlyph={<ControllerGlyph kind="select" />} navigateGlyph={<span aria-hidden="true">↕</span>} info={pageInfo} />
          </CardPageInfoContext.Provider>
        </section>
      )}

      <div className="console-identity" data-hidden={isApp} inert={isApp || noticesOpen || paletteOpen || !bootReady || dialog !== null}>
        <button
          type="button"
          className="console-wordmark"
          style={brandFont ? { fontFamily: brandFont } : undefined}
          aria-label="YAG / Yet Another Gateway"
          onClick={() => {
            wordmarkTaps.current++;
            if (wordmarkTaps.current >= 5) { wordmarkTaps.current = 0; openEaster(); }
          }}
        >
          YAG
        </button>
        {/* Caption and audio stack in one column: the block never reaches
            the menu's own column, however narrow the screen. */}
        <span className="console-identity-meta">
          <span className="console-identity-caption">Yet Another Gateway <span>Experimental</span></span>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <AudioControls onReplay={boot.replay} />
            <button
              type="button"
              className="console-sound"
              aria-label="Turn off console"
              title="Sleep / Turn off"
              onClick={shutdown.start}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
                <path d="M12 6v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </span>
      </div>

      {!isApp && (
        <>
        <nav className="console-mobile-nav" aria-label="Menu navigation" data-console-action inert={paletteOpen || !bootReady || noticesOpen || optionsOpen || dialog !== null}>
          <button type="button" aria-label="Previous category" disabled={menuCursor.cat === 0} onClick={() => stepMenu("left")}><DirectionGlyph direction="left" /></button>
          <button type="button" aria-label="Previous destination" disabled={menuCursor.item === 0} onClick={() => stepMenu("up")}><DirectionGlyph direction="up" /></button>
          <button type="button" aria-label="Next destination" disabled={menuCursor.item === category.items.length - 1} onClick={() => stepMenu("down")}><DirectionGlyph direction="down" /></button>
          <button type="button" aria-label={menuCursor.cat === CATEGORIES.length - 1 ? "Open notifications" : "Next category"} onClick={() => stepMenu("right")}><DirectionGlyph direction="right" /></button>
        </nav>
        <div className="console-help" data-console-action inert={paletteOpen || !bootReady || noticesOpen || dialog !== null}>
          <span className="console-help-arrows" aria-hidden="true">↔ ↕</span><span className="console-help-label">Navigate</span>
          <button type="button" onClick={toggleOptions} aria-label="Options, triangle button">
            <ControllerGlyph kind="options" />
            <span className="console-help-label">Options</span>
          </button>
          <button type="button" aria-label="Open selected destination" disabled={optionsOpen} onClick={() => activate(selected)}><ControllerGlyph kind="select" /><span className="console-help-label">Select</span></button>
          <button type="button" aria-label="Back to categories" disabled={optionsOpen} onClick={() => categoryRefs.current[menuCursor.cat]?.focus({ preventScroll: true })}><ControllerGlyph kind="back" /><span className="console-help-label">Back</span></button>
        </div>
        </>
      )}

      <p className="sr-only" aria-live="polite">
        {isApp
          ? `${appTitle} application. Escape returns to the menu.`
          : `${category.label}: ${selected.label}. ${selected.sub} ${selected.detail}`}
      </p>
      {paletteOpen && bootReady && <QuickJump />}
      <ConfirmDialog
        open={dialog !== null}
        title={dialog?.title ?? ""}
        message={dialog?.message ?? ""}
        choice={dialogChoice}
        onChoice={setDialogChoice}
        onConfirm={() => resolveDialog(true)}
        onCancel={() => resolveDialog(false)}
      />
      <TrophyToast enabled={bootReady} />
      <ParticleBurst />
      <ShutdownOverlay
        phase={shutdown.phase}
        onRestart={() => {
          shutdown.cancel();
          boot.replay();
        }}
      />
      <div className="console-throbber" data-active={phase !== "idle" && bootReady} aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => <span key={i} style={{ "--i": i } as CSSProperties} />)}
      </div>
      <EasterEgg open={easterOpen} onClose={() => setEasterOpen(false)} />
    </div>
  );
}
