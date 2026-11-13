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

export function monthlyPalette(date = new Date()): Float32Array {
  return new Float32Array(MONTHS[date.getMonth()].flatMap(rgb));
}

export function hourlyBrightness(date = new Date()): number {
  const hour = date.getHours() + date.getMinutes() / 60;
  const daylight = Math.max(0, Math.sin((Math.PI * (hour - 5)) / 16));
  return 0.72 + 0.28 * daylight;
}