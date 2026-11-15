import { useEffect, useRef, useState } from "react";
import { COMMIT_NOTICES } from "@/data/commits.generated";
import { ConsoleIcon } from "./ConsoleIcons";
import { cleanCommitTitle } from "./commitTitle";

export function XmbStatusBar({ unreadCount, noticesOpen, infoDisabled, searchDisabled, onInfo, onSearch }: {
  unreadCount: number;
  noticesOpen: boolean;
  infoDisabled: boolean;
  searchDisabled: boolean;
  onInfo: () => void;
  onSearch: () => void;
}) {
  const [date, setDate] = useState(() => new Date());
  const viewport = useRef<HTMLDivElement>(null);
  const message = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [distance, setDistance] = useState(0);
  const latest = cleanCommitTitle(COMMIT_NOTICES[0]?.subject, COMMIT_NOTICES[0]?.body);
  useEffect(() => {
    const timer = window.setInterval(() => setDate(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let disposed = false;
    const measure = () => {
      if (disposed || !viewport.current || !message.current) return;
      const width = message.current.scrollWidth;
      setDistance(Math.max(0, width - viewport.current.clientWidth));
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (viewport.current) observer?.observe(viewport.current);
    measure();
    void document.fonts.ready.then(measure);
    window.addEventListener("resize", measure);
    return () => { disposed = true; observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [latest]);
  useEffect(() => {
    const element = track.current;
    const environment = element?.closest(".console-environment");
    if (!element || !environment || !distance) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animation: Animation | undefined;
    const start = () => {
      animation?.cancel();
      if (motion.matches || environment.getAttribute("data-boot") !== "home") return;
      const duration = distance / 24 * 1000 + 3000;
      animation = element.animate([
        { transform: "translateX(0)", offset: 0 },
        { transform: "translateX(0)", offset: 1500 / duration },
        { transform: `translateX(${-distance}px)`, offset: 1 - 1500 / duration },
        { transform: `translateX(${-distance}px)`, offset: 1 },
      ], { duration, iterations: Infinity, easing: "linear" });
    };
    const pause = () => animation?.pause();
    const resume = () => { if (!element.closest(".console-status")?.matches(":hover, :focus-within")) animation?.play(); };
    const status = element.closest(".console-status");
    const boot = new MutationObserver(start);
    boot.observe(environment, { attributes: true, attributeFilter: ["data-boot"] });
    status?.addEventListener("mouseenter", pause); status?.addEventListener("mouseleave", resume);
    status?.addEventListener("focusin", pause); status?.addEventListener("focusout", resume);
    motion.addEventListener("change", start);
    start();
    return () => {
      animation?.cancel(); boot.disconnect(); motion.removeEventListener("change", start);
      status?.removeEventListener("mouseenter", pause); status?.removeEventListener("mouseleave", resume);
      status?.removeEventListener("focusin", pause); status?.removeEventListener("focusout", resume);
    };
  }, [distance, latest]);
  const clock = `${date.getDate()}/${date.getMonth() + 1} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return (
    <section className="console-status" aria-label="Console status">
      <div className="console-status-row">
        <span className="console-status-user" role="img" aria-label={`${unreadCount} unread notifications`}>
          <ConsoleIcon name="project" />
          <span aria-hidden="true">{unreadCount}</span>
        </span>
        <time className="console-clock" dateTime={date.toISOString()}>{clock}</time>
        <button className="console-search-toggle" data-console-action type="button" aria-label="Search all destinations" title="Search (/ or Ctrl+K)" inert={searchDisabled} onClick={onSearch}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.5" /><path d="m15.5 15.5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
        <button type="button" className="console-notice-toggle" data-console-action data-open={noticesOpen} disabled={infoDisabled}
          aria-expanded={noticesOpen} aria-controls="console-notices"
          aria-label={noticesOpen ? "Close notifications" : unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications, all read"} onClick={onInfo}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9.1" stroke="currentColor" strokeWidth="1.5" /><path d="M12 10.6v5.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="12" cy="7.4" r="1.05" fill="currentColor" /></svg>
          <span className="console-notice-dot" data-on={unreadCount > 0} aria-hidden="true" />
        </button>
      </div>
      <div ref={viewport} className="console-status-ticker" title={latest}>
        <div ref={track} className="console-status-track" data-scroll={distance > 0}>
          <span ref={message}>{latest}</span>
        </div>
      </div>
    </section>
  );
}
