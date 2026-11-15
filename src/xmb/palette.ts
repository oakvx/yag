const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

/** Twelve atmospheres, one per month: top, bottom, silk, and ambient light. */
const MONTHS = [
  ["#408fee", "#0a1738", "#e4efff", "#8fb6e6"],
  ["#8843ed", "#170d3a", "#eadfff", "#9a7ad6"],
  ["#1ee7b0", "#07302f", "#ddfff3", "#57c7a6"],
  ["#ef3999", "#2a1030", "#ffe4f1", "#e08ab6"],
  ["#79ec24", "#12300f", "#efffdb", "#94cf5a"],
  ["#1dc2e7", "#052a44", "#dff8ff", "#3cc0e0"],
  ["#f4ac32", "#3a1608", "#fff0d1", "#f2b24a"],
  ["#ef6543", "#35101a", "#ffe9df", "#f08c70"],
  ["#ef9142", "#2a1208", "#ffe9db", "#d08a58"],
  ["#ed322b", "#a41422", "#ffe1d9", "#fa6c59"],
  ["#3a76ed", "#0e1426", "#e6edff", "#7b8fb5"],
  ["#e93d6b", "#240814", "#ffe1e9", "#d84a72"],
] as const;

/** The twelve atmospheres by name, in month order, as the theme list reads them. */
export const THEME_NAMES = [
  "Ice", "Violet", "Mint", "Blossom", "Meadow", "Lagoon",
  "Amber", "Coral", "Copper", "Ember", "Slate", "Crimson",
] as const;

/** localStorage key; the shape version is embedded so old states are ignored. */
export const THEME_STORAGE_KEY = "yag-xmb-theme-v1";
/** Ember is the initial console appearance; Original still follows the month. */
const INITIAL_THEME = 9;

function readStoredTheme(): number | null {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === null) return INITIAL_THEME;
    if (raw === "original") return null;
    const month = Number(raw);
    return Number.isInteger(month) && month >= 0 && month < 12 ? month : INITIAL_THEME;
  } catch {
    return INITIAL_THEME;
  }
}

/** The operator's fixed atmosphere, or null for the original monthly rotation. */
export function selectedTheme(): number | null {
  return readStoredTheme();
}

/**
 * A theme being previewed while its entry is highlighted, before it is
 * confirmed: undefined = none, null = the original rotation, a number = a month.
 * Never stored; the Theme Settings screen clears it when it closes.
 */
let previewed: number | null | undefined;

export function previewTheme(month: number | null | undefined): void {
  previewed = month;
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
  const month = (previewed !== undefined ? previewed : readStoredTheme()) ?? date.getMonth();
  return new Float32Array(MONTHS[month].flatMap(rgb));
}

export function hourlyBrightness(date = new Date()): number {
  const hour = date.getHours() + date.getMinutes() / 60;
  const daylight = Math.max(0, Math.sin((Math.PI * (hour - 5)) / 16));
  return 0.72 + 0.28 * daylight;
}
