import { ArrowUpRight, Check, Gamepad2, Monitor, Sparkles } from "lucide-react";
import { useWorkspacePreferences, type Accent } from "./preferences";

export function WorkspaceSettings({ onConsole }: { onConsole: () => void }) {
  const { accent, motion, setAccent, setMotion } = useWorkspacePreferences();
  const accents: Array<{ id: Accent; label: string; description: string }> = [
    { id: "mint", label: "Evergreen", description: "A little closer to nature." },
    { id: "ice", label: "Glacier", description: "Cool, clear, focused." },
    { id: "sand", label: "Sandstone", description: "A warmer perspective." },
  ];
  return <section className="settings-page">
    <h1>Make yourself at home.</h1>
    <p className="settings-intro">Your workspace, with a little more you.</p>
    <div className="settings-section">
      <div className="settings-row-title"><Monitor size={19} /><div><h2>Accent color</h2><p>Keep the dark canvas. Choose your atmosphere.</p></div></div>
      <div className="accent-options" role="radiogroup" aria-label="Workspace accent color">
        {accents.map((option, index) => <button key={option.id} data-accent={option.id} className={`accent-option ${accent === option.id ? "is-selected" : ""}`} role="radio" aria-checked={accent === option.id} tabIndex={accent === option.id ? 0 : -1} onClick={() => setAccent(option.id)} onKeyDown={(event) => {
          const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % accents.length
            : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index + accents.length - 1) % accents.length : null;
          if (next === null) return;
          event.preventDefault(); setAccent(accents[next].id);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
        }}>
          <div className="accent-preview"><div /><span /><span /><span /></div>
          <div className="accent-option-title">{option.label}{accent === option.id && <Check size={15} />}</div><p>{option.description}</p>
        </button>)}
      </div>
    </div>
    <div className="settings-section settings-motion-row">
      <div className="settings-row-title"><Sparkles size={19} /><div><h2>Interface motion</h2><p>Animated connections and gentle transitions. System reduced-motion preferences always take priority.</p></div></div>
      <button className="settings-switch" role="switch" aria-checked={motion} aria-label="Interface motion" onClick={() => setMotion(!motion)}><span /></button>
    </div>
    <div className="settings-section settings-motion-row">
      <div className="settings-row-title"><Gamepad2 size={20} /><div><h2>The console</h2><p>YAG's home: the XMB with its atmospheres, sounds, trophies, and controller navigation. Workspace View is only a reading mode.</p></div></div>
      <button className="workspace-button secondary" onClick={onConsole}>Return to console <ArrowUpRight size={15} /></button>
    </div>
    <p className="local-settings-note"><Check size={14} />Preferences are saved only in this browser. No account required.</p>
  </section>;
}