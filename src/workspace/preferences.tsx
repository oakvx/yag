import { createContext, useContext, useState, type ReactNode } from "react";

export type Accent = "mint" | "ice" | "sand";

interface Preferences {
  accent: Accent;
  motion: boolean;
  setAccent: (accent: Accent) => void;
  setMotion: (motion: boolean) => void;
}

const PreferencesContext = createContext<Preferences | null>(null);

function readPreference(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; }
  catch { return fallback; }
}

function savePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); }
  catch { /* The workspace also works when browser storage is unavailable. */ }
}

export function WorkspacePreferences({ children }: { children: ReactNode }) {
  const [accent, updateAccent] = useState<Accent>(() => {
    const stored = readPreference("yag.workspace.accent", "mint");
    return stored === "ice" || stored === "sand" ? stored : "mint";
  });
  const [motion, updateMotion] = useState(() => readPreference("yag.workspace.motion", "on") === "on");

  return <PreferencesContext.Provider value={{
    accent,
    motion,
    setAccent: (value) => { updateAccent(value); savePreference("yag.workspace.accent", value); },
    setMotion: (value) => { updateMotion(value); savePreference("yag.workspace.motion", value ? "on" : "off"); },
  }}>{children}</PreferencesContext.Provider>;
}

export function useWorkspacePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("WorkspacePreferences is required");
  return value;
}