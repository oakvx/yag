import { useEffect, useState } from "react";
import { blip } from "./audio";
import { publicAsset } from "./assets";
import { TROPHY_ART } from "./trophyArtwork";
import { subscribeUnlocks, type TrophyDef, type TrophyGrade } from "./trophies";

export const GRADE_LABEL: Record<TrophyGrade, string> = {
  bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum",
};

/** The supplied trophy artwork for this grade. */
export function TrophyCup({ grade, className }: { grade: TrophyGrade; className?: string }) {
  return <img src={publicAsset(TROPHY_ART[grade])} alt="" className={className} />;
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
