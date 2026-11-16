/** Split the user-supplied EssE ti vector sheet into the existing XMB override slots. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("third_party/xmb-icons-esseti/icons_276.svg", root), "utf8");
const icons = {
  home: "user_home",
  explore: "web",
  operations: "Layer_32",
  project: "user",
  gamepad: "game",
  gateway: "user_home",
  connections: "add_user_copy",
  topology: "Layer_12_copy",
  routing: "Layer_19_copy",
  information: "Layer_43",
  shield: "Layer_9",
  download: "Layer_34",
  configuration: "Layer_26",
  monitor: "Layer_5",
  user: "folder",
  link: "Layer_45",
  contribute: "add_user",
  profile: "acc_information",
  trophy: "trophy",
};

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
  const page = await browser.newPage();
  // Parse as inert XML, then allow only vector geometry from the chosen groups.
  const art = await page.evaluate(({ source, icons }) => {
    const doc = new DOMParser().parseFromString(source, "image/svg+xml");
    const allowedTags = new Set(["g", "path", "circle", "ellipse", "rect", "polygon", "polyline"]);
    const allowedAttrs = new Set(["d", "x", "y", "cx", "cy", "r", "rx", "ry", "width", "height", "points", "transform", "fill", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity"]);
    return Object.fromEntries(Object.entries(icons).map(([name, id]) => {
      const original = doc.getElementById(id);
      if (!original) throw new Error(`Missing icon group: ${id}`);
      const group = document.importNode(original, true);
      for (const el of [group, ...group.querySelectorAll("*")]) {
        if (!allowedTags.has(el.localName)) throw new Error(`Unexpected element in ${id}: ${el.localName}`);
        for (const attr of [...el.attributes]) {
          if (!allowedAttrs.has(attr.name)) el.removeAttribute(attr.name);
        }
        for (const paint of ["fill", "stroke"]) {
          if (el.hasAttribute(paint) && el.getAttribute(paint) !== "none") el.setAttribute(paint, "#fff");
        }
      }
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.appendChild(group);
      document.body.appendChild(svg);
      const bounds = group.getBBox();
      if (bounds.width <= 0 || bounds.height <= 0) throw new Error(`Empty icon: ${id}`);
      const scale = 58 / Math.max(bounds.width, bounds.height);
      const x = (64 - bounds.width * scale) / 2;
      const y = (64 - bounds.height * scale) / 2;
      const markup = new XMLSerializer().serializeToString(group);
      svg.remove();
      return [name, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="#fff" transform="translate(${x} ${y}) scale(${scale}) translate(${-bounds.x} ${-bounds.y})">${markup}</g></svg>\n`];
    }));
  }, { source, icons });
  const destination = new URL("public/icons/xmb/", root);
  mkdirSync(destination, { recursive: true });
  for (const [name, svg] of Object.entries(art)) writeFileSync(new URL(`${name}.svg`, destination), svg);
  console.log(`Extracted ${Object.keys(art).length} icons to ${fileURLToPath(destination)}`);
} finally {
  await browser.close();
}
