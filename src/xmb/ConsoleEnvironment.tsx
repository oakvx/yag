import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
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

/* Pointer sensitivity: one deliberate input = one step, as with the PS3 D-pad. */
/** px the pointer must travel over the same category/item before hover selects it. */
const HOVER_TRAVEL = 14;
/** ms that must pass since the last selection change (≈ slide animation) before hover selects. */
const HOVER_SETTLE = 230;
/** px of accumulated wheel/trackpad delta needed for one step. */
const WHEEL_STEP = 70;
/** ms after a wheel step during which further events (inertia) are ignored. */
const WHEEL_COOLDOWN = 260;
/** ms without wheel events after which the accumulator is cleared. */
const WHEEL_IDLE_RESET = 160;
/** px per line for wheel events reported with deltaMode = DOM_DELTA_LINE. */
const WHEEL_LINE_PX = 33;

function ControllerGlyph({ kind }: { kind: "select" | "back" }) {
  return (
    <svg viewBox="0 0 24 24" className="controller-glyph" aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.2" />
      {kind === "select" ? (
        <path d="M8.8 8.8l6.4 6.4m0-6.4-6.4 6.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      ) : (
        <circle cx="12" cy="12" r="4.1" stroke="currentColor" strokeWidth="1.4" />
      )}
    </svg>
  );
}

function ConsoleClock() {
  const [date, setDate] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setDate(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours();
  const min = String(date.getMinutes()).padStart(2, "0");
  return (
    <div className="console-clock">
      <time dateTime={date.toISOString()}>{day}/{month} {hour}:{min}</time>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export function ConsoleEnvironment({ children }: { children: ReactNode }) {
  const {
    surface, journey, phase, path, query, menuCursor, chooseMenu, returnToMenu,
    navigate, paletteOpen, setPaletteOpen, route,
  } = useRouter();
  const [direction, setDirection] = useState<"right" | "left">("right");
  const boot = useBootSequence();
  const [hoverAnchor, setHoverAnchor] = useState<number | null>(null);
  const [easterOpen, setEasterOpen] = useState(false);
  const brandFont = useBrandFont();
  const wordmarkTaps = useRef(0);
  const memory = useRef(CATEGORIES.map(() => 0));
  const cursorRef = useRef(menuCursor);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const categoryRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLElement>(null);
  const focusAfterMove = useRef(false);
  const wheel = useRef({ x: 0, y: 0, last: 0, lockedUntil: 0, lastMag: 0 });
  const lastChange = useRef(0);
  const hoverIntent = useRef({ key: "", travel: 0, timer: 0 });
  const touch = useRef({ x: 0, y: 0, swipeAt: 0 });
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
  const bootReady = boot.stage === "home";
  const openEaster = useCallback(() => {
    if (!bootReady) return;
    setEasterOpen(true);
    emitWave(menuCursor.cat, 0.9);
    blip("trophy");
  }, [bootReady, menuCursor.cat]);
  useEasterEgg(openEaster);
  const fileOrigin = useRef(menuCursor);
  const fileWasApp = useRef(isApp);

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
    setHoverAnchor(null);
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

  const activate = useCallback((item: XmbItem) => {
    blip("select");
    const target = itemTarget(item);
    if (target) navigate(target);
    else if (item.href) window.open(item.href, "_blank", "noopener,noreferrer");
  }, [navigate]);

  const back = useCallback(() => { blip("back"); returnToMenu(); }, [returnToMenu]);

  useEffect(() => {
    if (focusAfterMove.current) {
      itemRefs.current[menuCursor.item]?.focus({ preventScroll: true });
      focusAfterMove.current = false;
    }
  }, [menuCursor]);

  useEffect(() => {
    if (!bootReady) return;
    if (surface === "menu") {
      setHoverAnchor(null);
      const timer = window.setTimeout(() => menuRef.current?.focus({ preventScroll: true }), 30);
      return () => window.clearTimeout(timer);
    }
    appRef.current?.scrollTo({ top: 0 });
    appRef.current?.focus({ preventScroll: true });
  }, [surface, path, bootReady]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!bootReady || paletteOpen || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const editing = el && (el.matches("input, textarea, select") || el.isContentEditable);
      if (editing && e.key !== "Escape") return;
      if (isApp) {
        if (e.key === "Escape" || e.key === "Backspace") { e.preventDefault(); back(); }
        return;
      }
      if (phase === "cover") return;
      if (el?.closest("[data-console-action]") && (e.key === "Enter" || e.key === " ")) return;
      if (el?.closest("[data-console-action]") && e.key.startsWith("Arrow")) menuRef.current?.focus();
      const c = cursorRef.current;
      if (e.key.startsWith("Arrow")) resetHover();
      switch (e.key) {
        case "ArrowRight":
        case "ArrowLeft":
          e.preventDefault();
          setHoverAnchor(null);
          focusAfterMove.current = el?.hasAttribute("data-console-item") ?? false;
          selectCategory(c.cat + (e.key === "ArrowRight" ? 1 : -1));
          break;
        case "ArrowDown":
        case "ArrowUp":
          e.preventDefault();
          setHoverAnchor(null);
          focusAfterMove.current = el?.hasAttribute("data-console-item") ?? false;
          selectItem(c.item + (e.key === "ArrowDown" ? 1 : -1));
          break;
        case "Enter":
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
  }, [activate, back, bootReady, isApp, paletteOpen, phase, resetHover, selectCategory, selectItem]);

  const onItemClick = (e: MouseEvent<HTMLAnchorElement>, item: XmbItem) => {
    if (performance.now() - touch.current.swipeAt < 350) { e.preventDefault(); return; }
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0 || item.href) return;
    e.preventDefault();
    activate(item);
  };

  const selectionStyle = { "--selected-category": menuCursor.cat } as CSSProperties;
  const viewNames: Record<string, string> = {
    system: "System Information", configuration: "Configuration", operations: "Operations",
    quickstart: "Quickstart", contributing: "Contributing",
  };
  const appTitle = viewNames[query.view] ?? route.label;
  const listAnchor = hoverAnchor ?? menuCursor.item;
  const selectionDelta = menuCursor.item - listAnchor;
  const selectionOffset = selectionDelta < 0 ? selectionDelta - 1.35 : selectionDelta;

  return (
    <div className="console-environment" data-surface={surface} data-phase={phase} data-journey={journey} data-boot={boot.stage} data-skipping={boot.skipping}>
      <RibbonWallpaper clock={boot.clock} />
      <ConsoleClock />
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
        aria-hidden={isApp || !bootReady || undefined}
        inert={isApp || paletteOpen || !bootReady}
        tabIndex={-1}
        onWheel={(e) => {
          if (isApp) return;
          const now = performance.now();
          const w = wheel.current;
          if (now - w.last > WHEEL_IDLE_RESET) { w.x = 0; w.y = 0; }
          w.last = now;
          const unit = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? window.innerHeight : 1;
          const mag = Math.max(Math.abs(e.deltaX), Math.abs(e.deltaY)) * unit;
          if (now < w.lockedUntil) {
            // Decaying deltas are the inertia tail of the gesture that just stepped: keep ignoring them.
            // Equal-sized wheel notches are not decaying, so they still step once per cooldown.
            if (mag < w.lastMag * 0.98 || mag < 4) w.lockedUntil = now + WHEEL_COOLDOWN;
            w.lastMag = mag;
            return;
          }
          w.lastMag = mag;
          w.x += e.deltaX * unit;
          w.y += e.deltaY * unit;
          const horizontal = Math.abs(w.x) > Math.abs(w.y);
          const amount = horizontal ? w.x : w.y;
          if (Math.abs(amount) < WHEEL_STEP) return;
          w.x = 0; w.y = 0; w.lockedUntil = now + WHEEL_COOLDOWN;
          setHoverAnchor(null);
          resetHover();
          const c = cursorRef.current;
          if (horizontal) selectCategory(c.cat + Math.sign(amount));
          else selectItem(c.item + Math.sign(amount));
        }}
        onTouchStart={(e) => {
          touch.current.x = e.touches[0].clientX;
          touch.current.y = e.touches[0].clientY;
        }}
        onTouchEnd={(e) => {
          const dx = e.changedTouches[0].clientX - touch.current.x;
          const dy = e.changedTouches[0].clientY - touch.current.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 44) return;
          touch.current.swipeAt = performance.now();
          if (Math.abs(dx) > Math.abs(dy)) selectCategory(menuCursor.cat - Math.sign(dx));
          else selectItem(menuCursor.item - Math.sign(dy));
        }}
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
          style={{ "--selection-offset": selectionOffset } as CSSProperties}
          onMouseLeave={() => { setHoverAnchor(null); resetHover(); }}
        >
          <div className="console-selection-light" aria-hidden="true" />
          <ul>
            {category.items.map((item, i) => {
              const delta = i - listAnchor;
              // Previous entries move above the crossbar; selection remains at the intersection.
              const offset = delta < 0 ? delta - 1.35 : delta;
              const on = i === menuCursor.item;
              return (
                <li
                  key={item.id}
                  className={cn("console-destination-position", on && "is-selected", delta < 0 && "is-above")}
                  style={{ "--item-offset": offset } as CSSProperties}
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
                    onMouseMove={(e) => hoverMove(e, `${category.id}-${i}`, () => {
                      // Keep mouse targets stationary; the highlight travels to the hovered row.
                      setHoverAnchor((anchor) => anchor ?? cursorRef.current.item);
                      selectItem(i);
                    })}
                    onFocus={() => selectItem(i)}
                    onClick={(e) => onItemClick(e, item)}
                  >
                    <span className="console-item-art"><ConsoleIcon name={item.icon} /></span>
                    <span className="console-item-label">{item.label}{item.href && <span className="console-external">↗</span>}</span>
                    {/* The description rides the selected row: beside its label, never over the next one. */}
                    {on && (
                      <span className="console-description">
                        <span className="console-description-lead">{item.sub}</span>
                        <span className="console-description-detail">{item.detail}</span>
                      </span>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {isApp && (
        <section
          className={cn("console-application", phase === "cover" && "is-leaving")}
          data-testid="console-application"
          aria-label={appTitle}
          aria-hidden={!bootReady || undefined}
          inert={paletteOpen || !bootReady}
        >
          <header className="console-application-header">
            <button type="button" onClick={back} className="console-back" aria-label="Back to XMB menu">
              <span aria-hidden="true">‹</span> Back
            </button>
            <ConsoleIcon name={appItem.icon} className="console-app-icon" />
            <div>
              <p className="console-app-category">{appCategory.label}</p>
              <h2>{appTitle}</h2>
            </div>
          </header>
          <main ref={appRef} id="main-content" tabIndex={-1} className="console-application-content code-scroll @container">
            <div key={path} className="console-app-content-enter">{children}</div>
            <div className="console-app-colophon">YAG is experimental software. Repository references are authoritative.</div>
          </main>
          <button type="button" className="console-app-back-hint" onClick={back}>
            <ControllerGlyph kind="back" /> Back to menu <kbd>Esc</kbd>
          </button>
        </section>
      )}

      <div className="console-identity" data-hidden={isApp} inert={isApp || paletteOpen || !bootReady}>
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
        <span className="console-identity-caption">Yet Another Gateway <span>Experimental</span></span>
        <AudioControls onReplay={boot.replay} />
      </div>

      {!isApp && (
        <div className="console-help" data-console-action inert={paletteOpen || !bootReady}>
          <span className="console-help-arrows" aria-hidden="true">↔ ↕</span><span>Navigate</span>
          <button type="button" onClick={() => activate(selected)}><ControllerGlyph kind="select" /> Select</button>
          <button type="button" onClick={() => categoryRefs.current[menuCursor.cat]?.focus()}><ControllerGlyph kind="back" /> Back</button>
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {isApp
          ? `${appTitle} application. Escape returns to the menu.`
          : `${category.label}: ${selected.label}. ${selected.sub} ${selected.detail}`}
      </p>
      {paletteOpen && bootReady && <QuickJump />}
      <EasterEgg open={easterOpen} onClose={() => setEasterOpen(false)} />
      <button className="sr-only focus:not-sr-only" type="button" inert={paletteOpen || !bootReady} onClick={() => setPaletteOpen(true)}>Search all destinations</button>
    </div>
  );
}
