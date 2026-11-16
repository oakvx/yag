import { useEffect, useState } from "react";
import type { XmbListEntry } from "@/xmb/XmbList";
import { XmbScreen } from "@/components/XmbScreen";
import {
  announceThemeChange, previewTheme, selectedTheme, setSelectedTheme, THEME_NAMES, themeHex,
} from "@/xmb/palette";
import { unlockTrophy } from "@/xmb/trophies";

/**
 * Theme Settings: the console's wallpaper atmosphere.
 *
 * The list is the console's own list: the original monthly rotation, then
 * the twelve atmospheres of palette.ts in month order, each with its own
 * swatch. Moving the highlight previews an atmosphere on the wallpaper at
 * once; confirming it fixes it for the whole console and stores the choice
 * in this browser. Leaving the screen without confirming puts the previous
 * atmosphere back. Choosing "Original" returns to the monthly rotation.
 */
export function ThemeSettingsPage() {
  const [cursor, setCursor] = useState(() => {
    const fixed = selectedTheme();
    return fixed === null ? 0 : fixed + 1;
  });
  const [applied, setApplied] = useState<number | null>(() => selectedTheme());

  // The preview ends with the screen: whatever was confirmed comes back.
  useEffect(() => () => {
    previewTheme(undefined);
    announceThemeChange();
  }, []);

  const month = new Date().getMonth();
  const previewMonth = cursor === 0 ? month : cursor - 1;
  const previewName = cursor === 0 ? "Original" : THEME_NAMES[previewMonth];
  const previewColors = themeHex(previewMonth);
  const previewSaved = applied === (cursor === 0 ? null : cursor - 1);
  const previewStatus = cursor === 0
    ? previewSaved ? "Automatic rotation" : "Previewing rotation"
    : previewSaved ? "Saved atmosphere" : "Live preview";
  const previewDescription = cursor === 0
    ? "The wallpaper follows the current month."
    : previewSaved ? "This atmosphere is saved for every month." : "Select this atmosphere to keep it.";
  const entries: XmbListEntry[] = [
    {
      key: "original",
      swatch: [themeHex(month)[0], themeHex(month)[1]],
      title: "Original",
      sub: "Automatic monthly rotation",
      meta: applied === null ? cursor === 0 ? "Active" : "Saved" : cursor === 0 ? "Preview" : null,
      detail: "The wallpaper follows the twelve months of the year. This is the atmosphere of the current month.",
      ariaLabel: "Original, automatic monthly rotation",
    },
    ...THEME_NAMES.map((name, i) => ({
      key: `theme-${i}`,
      swatch: [themeHex(i)[0], themeHex(i)[1]] as [string, string],
      title: name,
      sub: `Atmosphere ${i + 1} of 12`,
      meta: applied === i ? cursor === i + 1 ? "Active" : "Saved" : cursor === i + 1 ? "Preview" : null,
      detail: "Fix this atmosphere for every month. The choice is stored in this browser.",
      ariaLabel: `Atmosphere ${name}`,
    })),
  ];

  const preview = (index: number) => {
    setCursor(index);
    previewTheme(index === 0 ? null : index - 1);
    announceThemeChange();
  };

  const apply = (index: number) => {
    const target = index === 0 ? null : index - 1;
    setSelectedTheme(target);
    setApplied(target);
    previewTheme(undefined);
    announceThemeChange();
    unlockTrophy("atmosphere");
  };

  return <div className="xmb-theme-settings-layout">
    <XmbScreen subtitle="Twelve atmospheres or the original monthly rotation. Highlight to preview; select to keep."
      testId="theme-settings" selected={cursor} onSelect={preview} onHighlight={(index) => {
        setCursor(index); previewTheme(index === 0 ? null : index - 1); announceThemeChange();
      }} onActivate={apply} sections={[{ id: "atmospheres", label: "Wallpaper atmospheres", entries }]} />
    <aside className="xmb-theme-preview" aria-label="Selected wallpaper palette" data-state={previewSaved ? "saved" : "preview"}>
      <div className="xmb-theme-preview-art" aria-hidden="true" style={{
        backgroundImage: `radial-gradient(ellipse at 72% 78%, ${previewColors[3]}88, transparent 54%), linear-gradient(150deg, ${previewColors[0]}, ${previewColors[1]})`,
      }}>
        <div className="xmb-theme-preview-art-copy">
          <span>WALLPAPER ATMOSPHERE · {String(previewMonth + 1).padStart(2, "0")} / 12</span>
          <strong>{previewName}</strong>
        </div>
      </div>
      <div className="xmb-theme-preview-heading">
        <div>
          <span className="xmb-theme-preview-kicker">{previewStatus}</span>
          <h2>{previewName}</h2>
        </div>
        <span className="xmb-theme-preview-index">{String(previewMonth + 1).padStart(2, "0")}</span>
      </div>
      <p className="xmb-theme-preview-description">{previewDescription}</p>
      <div className="xmb-theme-palette" aria-label="Palette colors">
        {[
          ["Horizon", previewColors[0]],
          ["Depth", previewColors[1]],
          ["Silk", previewColors[2]],
          ["Ambient", previewColors[3]],
        ].map(([label, color]) => (
          <div className="xmb-theme-color" key={label}>
            <span className="xmb-theme-color-chip" style={{ backgroundColor: color }} />
            <span>{label}</span>
            <code>{color}</code>
          </div>
        ))}
      </div>
      <p className="xmb-theme-preview-hint">Move through the list to preview · Select to save</p>
    </aside>
  </div>;
}
