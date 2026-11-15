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
  const entries: XmbListEntry[] = [
    {
      key: "original",
      swatch: [themeHex(month)[0], themeHex(month)[1]],
      title: "Original",
      sub: "Automatic monthly rotation",
      meta: applied === null ? "Active" : null,
      detail: "The wallpaper follows the twelve months of the year. This is the atmosphere of the current month.",
      ariaLabel: "Original, automatic monthly rotation",
    },
    ...THEME_NAMES.map((name, i) => ({
      key: `theme-${i}`,
      swatch: [themeHex(i)[0], themeHex(i)[1]] as [string, string],
      title: name,
      sub: `Atmosphere ${i + 1} of 12`,
      meta: applied === i ? "Active" : null,
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

  return <XmbScreen subtitle="Twelve atmospheres or the original monthly rotation. Highlight to preview; select to keep."
    testId="theme-settings" selected={cursor} onSelect={preview} onHighlight={(index) => {
      previewTheme(index === 0 ? null : index - 1); announceThemeChange();
    }} onActivate={apply} sections={[{ id: "atmospheres", label: "Wallpaper atmospheres", entries }]} />;
}
