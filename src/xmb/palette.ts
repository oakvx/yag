const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

/** Twelve restrained, blue-led monthly atmospheres: top, bottom, silk, and ambient light. */
const MONTHS = [
  ["#315b95", "#071338", "#b6d8fa", "#3d82c9"],
  ["#3d5f94", "#0b153c", "#c5dcf7", "#567dc1"],
  ["#376d91", "#0b1b40", "#c4e5ed", "#5495b5"],
  ["#327d91", "#08233e", "#bee8ec", "#4ba8ba"],
  ["#327e91", "#06233c", "#c7e9df", "#53aba7"],
  ["#2a789e", "#071f3d", "#bce5f1", "#46a3c8"],
  ["#2d79a2", "#071d43", "#bfdef6", "#459bca"],
  ["#355f9c", "#091840", "#c4d6f5", "#527dc4"],
  ["#465e91", "#111939", "#d0d5ed", "#7378b6"],
  ["#3e557c", "#111a37", "#d0d9e9", "#7283a8"],
  ["#356d90", "#0a1b3c", "#c4e1ee", "#548dab"],
  ["#3f6793", "#0b1838", "#e0ebf5", "#779ec1"],
] as const;

/** The twelve atmospheres by name, in month order, as the theme list reads them. */
export const THEME_NAMES = [
  "Zaffiro", "Indaco", "Azzurro", "Laguna", "Marea", "Oceano",
  "Cielo", "Sera", "Nebbia", "Penombra", "Acqua", "Alba",
] as const;

/** localStorage key; the shape version is embedded so old states are ignored. */
export const THEME_STORAGE_KEY = "yag-xmb-theme-v1";

function readStoredTheme(): number | null {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === null || raw === "original") return null;
    const month = Number(raw);
    return Number.isInteger(month) && month >= 0 && month < 12 ? month : null;
  } catch {
    return null;
  }
}

/** The operator's fixed atmosphere, or null for the original monthly rotation. */
export function selectedTheme(): number | null {
  return readStoredTheme();
}

/** Fix one atmosphere by month index, or restore the original rotation with null. */
export function setSelectedTheme(month: number | null): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, month === null ? "original" : String(month));
  } catch {
    /* Storage unavailable (private mode, file://): the choice simply does not persist. */
  }
}

/** Tell the wallpaper a theme changed, so it blends to the new palette at once. */
export function announceThemeChange(): void {
  window.dispatchEvent(new Event("yag:theme"));
}

/** The raw colors of one atmosphere (top, bottom, silk, ambient light). */
export function themeHex(month: number): readonly [string, string, string, string] {
  return MONTHS[month % 12];
}

export function monthlyPalette(date = new Date()): Float32Array {
  const month = readStoredTheme() ?? date.getMonth();
  return new Float32Array(MONTHS[month].flatMap(rgb));
}

export function hourlyBrightness(date = new Date()): number {
  const hour = date.getHours() + date.getMinutes() / 60;
  const daylight = Math.max(0, Math.sin((Math.PI * (hour - 5)) / 16));
  return 0.72 + 0.28 * daylight;
}
