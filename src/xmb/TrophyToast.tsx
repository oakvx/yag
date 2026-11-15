import { useEffect, useState } from "react";
import { blip } from "./audio";
import { EXTRA_ICON_PATHS } from "./extraIcons";
import { subscribeUnlocks, type TrophyDef, type TrophyGrade } from "./trophies";

const GRADE_COLORS: Record<TrophyGrade, string> = {
  bronze: "#efb07f",
  silver: "#f4f8fb",
  gold: "#ffe58f",
  platinum: "#eaf8ff",
};

export const GRADE_LABEL: Record<TrophyGrade, string> = {
  bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum",
};

/** The cup, tinted by grade. Drawn for this project; no console artwork. */
export function TrophyCup({ grade, className }: { grade: TrophyGrade; className?: string }) {
  const color = GRADE_COLORS[grade];
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path d={EXTRA_ICON_PATHS.trophy} fill={color} fillRule="evenodd" />
    </svg>
  );
}

/** One notification at a time, top right, the way the console announces a trophy. */
export function TrophyToast({ enabled }: { enabled: boolean }) {
  const [queue, setQueue] = useState<TrophyDef[]>([]);
  const [current, setCurrent] = useState<TrophyDef | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => subscribeUnlocks((def) => setQueue((q) => [...q, def])), []);

  useEffect(() => {
    if (!enabled || current || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    setCurrent(next);
    setLeaving(false);
    blip("trophy");
  }, [enabled, current, queue]);

  useEffect(() => {
    if (!current) return;
    const hide = window.setTimeout(() => setLeaving(true), 4200);
    const done = window.setTimeout(() => setCurrent(null), 4600);
    return () => { window.clearTimeout(hide); window.clearTimeout(done); };
  }, [current]);

  if (!current) return null;
  return (
    <div className="trophy-toast" data-leaving={leaving} data-grade={current.grade} role="status" aria-live="polite">
      <TrophyCup grade={current.grade} className="trophy-toast-cup" />
      <span className="trophy-toast-body">
        <span className="trophy-toast-kicker">Trophy earned · {GRADE_LABEL[current.grade]}</span>
        <span className="trophy-toast-title">{current.title}</span>
      </span>
    </div>
  );
}
