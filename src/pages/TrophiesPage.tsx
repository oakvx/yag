import { useState } from "react";
import type { XmbListEntry } from "@/xmb/XmbList";
import { XmbScreen } from "@/components/XmbScreen";
import { GRADE_LABEL } from "@/xmb/TrophyToast";
import { TROPHIES, useTrophyState, type TrophyGrade } from "@/xmb/trophies";
import { TROPHY_ART } from "@/xmb/trophyArtwork";
import { publicAsset } from "@/xmb/assets";

const stamp = (at: number) => {
  const date = new Date(at);
  return `${date.getDate()}/${date.getMonth() + 1}`;
};
const GRADES: readonly TrophyGrade[] = ["bronze", "silver", "gold", "platinum"];

/** Trophies: what exploring the console has earned. Stored only in this browser. */
export function TrophiesPage() {
  const state = useTrophyState();
  const [cursor, setCursor] = useState(0);
  const done = TROPHIES.filter((trophy) => state.unlocked[trophy.id]).length;
  const percent = Math.round((done / TROPHIES.length) * 100);
  const selected = TROPHIES[cursor] ?? TROPHIES[0];
  const unlockedAt = state.unlocked[selected.id];
  const veiled = selected.hidden && !unlockedAt;

  const entries: XmbListEntry[] = TROPHIES.map((trophy) => {
    const at = state.unlocked[trophy.id];
    const hidden = trophy.hidden && !at;
    return {
      key: trophy.id,
      image: TROPHY_ART[trophy.grade],
      tone: trophy.grade,
      title: hidden ? "Hidden trophy" : trophy.title,
      sub: hidden ? "Keep exploring." : trophy.text,
      meta: at ? `${GRADE_LABEL[trophy.grade]} · ${stamp(at)}` : `${GRADE_LABEL[trophy.grade]} · Locked`,
      ariaLabel: `${hidden ? "Hidden trophy" : trophy.title}, ${at ? "unlocked" : "locked"}`,
    };
  });

  const gradeProgress = GRADES.map((grade) => {
    const trophies = TROPHIES.filter((trophy) => trophy.grade === grade);
    const unlocked = trophies.filter((trophy) => state.unlocked[trophy.id]).length;
    return { grade, unlocked, total: trophies.length };
  });
  const selectedGrade = gradeProgress.find(({ grade }) => grade === selected.grade) ?? gradeProgress[0];

  return <div className="xmb-trophy-layout">
    <XmbScreen testId="trophies" subtitle={`${done} of ${TROPHIES.length} trophies unlocked (${percent}%). Kept only in this browser.`}
      selected={cursor} onSelect={setCursor} onHighlight={setCursor}
      header={<div className="xmb-trophy-progress" role="group" aria-label="Trophy collection progress">
        <div className="xmb-trophy-progress-copy">
          <span className="xmb-trophy-progress-count">{done}<span> / {TROPHIES.length}</span></span>
          <span className="xmb-trophy-progress-label">trophies unlocked</span>
          <span className="xmb-trophy-progress-percent">{percent}%</span>
        </div>
        <div className="xmb-trophy-progress-track" role="progressbar" aria-label="Trophy collection progress"
          aria-valuemin={0} aria-valuemax={TROPHIES.length} aria-valuenow={done}
          aria-valuetext={`${done} of ${TROPHIES.length} trophies unlocked`}>
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>}
      sections={[{ id: "trophies", label: "Trophy collection", entries }]} />
    <aside className="xmb-trophy-details" data-grade={selected.grade} aria-label="Selected trophy details" aria-live="polite">
      <div className="xmb-trophy-details-heading">
        <img src={publicAsset(TROPHY_ART[selected.grade])} alt="" className="xmb-trophy-details-icon" />
        <span>{GRADE_LABEL[selected.grade]}</span>
        <span className="xmb-trophy-details-status">{unlockedAt ? "Unlocked" : "Locked"}</span>
      </div>
      <h2>{veiled ? "Hidden trophy" : selected.title}</h2>
      <p>{veiled ? "Keep exploring to reveal this trophy." : selected.text}</p>
      {unlockedAt && <p className="xmb-trophy-earned-date">Earned {stamp(unlockedAt)}</p>}
      <div className="xmb-trophy-tier">
        <div><span>{GRADE_LABEL[selected.grade]} progress</span><span>{selectedGrade.unlocked} / {selectedGrade.total}</span></div>
        <div className="xmb-trophy-tier-track" role="progressbar" aria-label={`${GRADE_LABEL[selected.grade]} trophy progress`}
          aria-valuemin={0} aria-valuemax={selectedGrade.total} aria-valuenow={selectedGrade.unlocked}>
          <span style={{ width: `${Math.round((selectedGrade.unlocked / selectedGrade.total) * 100)}%` }} />
        </div>
      </div>
      <div className="xmb-trophy-grade-list" aria-label="Progress by trophy grade">
        {gradeProgress.map(({ grade, unlocked, total }) => (
          <div className="xmb-trophy-grade-row" data-grade={grade} key={grade}>
            <span>{GRADE_LABEL[grade]}</span><span>{unlocked} / {total}</span>
          </div>
        ))}
      </div>
    </aside>
  </div>;
}
