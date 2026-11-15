import type { XmbListEntry } from "@/xmb/XmbList";
import { XmbScreen } from "@/components/XmbScreen";
import { GRADE_LABEL } from "@/xmb/TrophyToast";
import { TROPHIES, useTrophyState } from "@/xmb/trophies";

const stamp = (at: number) => {
  const date = new Date(at);
  return `${date.getDate()}/${date.getMonth() + 1}`;
};

/** Trophies: what exploring the console has earned. Stored only in this browser. */
export function TrophiesPage() {
  const state = useTrophyState();
  const done = TROPHIES.filter((trophy) => state.unlocked[trophy.id]).length;
  const percent = Math.round((done / TROPHIES.length) * 100);

  const entries: XmbListEntry[] = TROPHIES.map((trophy) => {
    const at = state.unlocked[trophy.id];
    const veiled = trophy.hidden && !at;
    return {
      key: trophy.id,
      icon: "trophy",
      title: veiled ? "Hidden trophy" : trophy.title,
      sub: veiled ? "Keep exploring." : trophy.text,
      meta: at ? `${GRADE_LABEL[trophy.grade]} · ${stamp(at)}` : `${GRADE_LABEL[trophy.grade]} · Locked`,
      ariaLabel: `${veiled ? "Hidden trophy" : trophy.title}, ${at ? "unlocked" : "locked"}`,
    };
  });

  return <XmbScreen testId="trophies" subtitle={`${done} of ${TROPHIES.length} trophies unlocked (${percent}%). Kept only in this browser.`}
    sections={[{ id: "trophies", label: "Trophy collection", entries }]} />;
}
