import { useState } from "react";
import { XmbList, type XmbListEntry } from "@/xmb/XmbList";
import { announceThemeChange, selectedTheme, setSelectedTheme, THEME_NAMES, themeHex } from "@/xmb/palette";

/**
 * Theme Settings: the console's wallpaper atmosphere.
 *
 * The list is the console's own list: the original monthly rotation, then
 * the twelve atmospheres of palette.ts in month order, each with its own
 * swatch. Selecting an entry fixes it for the whole console — the wallpaper
 * blends to it at once and the choice is stored in this browser, the same
 * way the audio preference is. Choosing "Originale" returns to the automatic
 * monthly rotation.
 */
export function ThemeSettingsPage() {
  const [cursor, setCursor] = useState(() => {
    const fixed = selectedTheme();
    return fixed === null ? 0 : fixed + 1;
  });
  const [applied, setApplied] = useState<number | null>(() => selectedTheme());

  const month = new Date().getMonth();
  const entries: XmbListEntry[] = [
    {
      key: "original",
      swatch: [themeHex(month)[0], themeHex(month)[1]],
      title: "Originale",
      sub: "Rotazione mensile automatica",
      meta: applied === null ? "Attiva" : null,
      detail:
        "Il wallpaper segue i dodici mesi dell'anno. Questa è l'atmosfera del mese in corso.",
      ariaLabel: "Originale, rotazione mensile automatica",
    },
    ...THEME_NAMES.map((name, i) => ({
      key: `theme-${i}`,
      swatch: [themeHex(i)[0], themeHex(i)[1]] as [string, string],
      title: name,
      sub: `Atmosfera ${i + 1} di 12`,
      meta: applied === i ? "Attiva" : null,
      detail: "Fissa questa atmosfera per tutti i mesi. La scelta resta salvata in questo browser.",
      ariaLabel: `Atmosfera ${name}`,
    })),
  ];

  const apply = (index: number) => {
    const target = index === 0 ? null : index - 1;
    setSelectedTheme(target);
    setApplied(target);
    announceThemeChange();
  };

  return (
    <div className="settings-screen" data-testid="theme-settings">
      <p className="settings-lede">
        L'atmosfera del wallpaper della console: dodici atmosfere, o la rotazione mensile
        originale. La scelta viene salvata solo in questo browser, come le preferenze audio.
      </p>
      <XmbList
        entries={entries}
        selected={cursor}
        onSelect={setCursor}
        onHighlight={setCursor}
        onActivate={apply}
        compact
        focusOnMount
        className="theme-settings-list settings-list"
        ariaLabel="Atmosfere del wallpaper"
      />
      <p className="settings-note">
        Il wallpaper si mescola all'atmosfera scelta nell'istante in cui la si conferma.
      </p>
    </div>
  );
}
