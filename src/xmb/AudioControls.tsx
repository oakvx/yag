import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { blip, xmbAudio } from "./audio";

export function AudioControls({ onReplay }: { onReplay: () => void }) {
  const prefs = useSyncExternalStore(xmbAudio.subscribe, xmbAudio.getPreferences, xmbAudio.getPreferences);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const held = useRef(false);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const restart = () => {
    setOpen(false);
    onReplay();
  };
  return (
    <div ref={root} className="console-audio" data-console-action>
      <button
        type="button"
        className="console-sound"
        aria-expanded={open}
        aria-controls="console-audio-panel"
        aria-label="Audio settings. Press and hold to replay the boot sequence."
        onPointerDown={() => {
          held.current = false;
          timer.current = window.setTimeout(() => { held.current = true; restart(); }, 850);
        }}
        onPointerUp={() => clearTimeout(timer.current)}
        onPointerCancel={() => clearTimeout(timer.current)}
        onPointerLeave={() => clearTimeout(timer.current)}
        onContextMenu={(event) => event.preventDefault()}
        onClick={() => {
          if (held.current) { held.current = false; return; }
          xmbAudio.unlock();
          setOpen((value) => !value);
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M4 10v4h3l5 4V6l-5 4z" />
          {prefs.music || prefs.effects ? <path d="M16 8a6 6 0 0 1 0 8M14 10a3 3 0 0 1 0 4" /> : <path d="m16 10 4 4m0-4-4 4" />}
        </svg>
        <span>Audio</span>
      </button>
      {open && (
        <div id="console-audio-panel" className="console-audio-panel" role="dialog" aria-label="Audio settings">
          <p className="console-audio-title">Audio settings</p>
          <button type="button" aria-pressed={prefs.music} onClick={() => xmbAudio.setPreferences({ music: !prefs.music })}>
            Music <span>{prefs.music ? "On" : "Off"}</span>
          </button>
          <button type="button" aria-pressed={prefs.effects} onClick={() => { xmbAudio.setPreferences({ effects: !prefs.effects }); blip("select"); }}>
            Effects <span>{prefs.effects ? "On" : "Off"}</span>
          </button>
          <label>
            Volume <span>{Math.round(prefs.master * 100)}%</span>
            <input type="range" min="0" max="1" step="0.05" value={prefs.master} onChange={(event) => xmbAudio.setPreferences({ master: Number(event.target.value) })} />
          </label>
          <button type="button" onClick={restart}>Replay the boot sequence</button>
        </div>
      )}
    </div>
  );
}