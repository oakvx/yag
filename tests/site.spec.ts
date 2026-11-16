import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import statsSnapshot from "../src/data/repository-stats.generated.json" with { type: "json" };

// Browser checks are deterministic and do not consume GitHub's public rate limit.
test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/api\.github\.com\/repos\/oakvx\/yag(?:[/?]|$)/, route => route.abort());
});

/** The console remembers a completed boot for the session; tests that need the menu skip the boot film. */
const skipBoot = (page: Page) => page.addInitScript(() => sessionStorage.setItem("yag-xmb-boot-seen", "1"));

/** The separate workspace marker also supports pages with a document view parameter. */
async function openWorkspace(page: Page, path = "/") {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}workspace=1`);
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  // The router commits the new location after its 240 ms cover phase; the page's heading appears only then.
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
}

test.describe("the XMB console is the site", () => {
  test("supplied audio files play for boot and menu actions", async ({ page }) => {
    await skipBoot(page);
    await page.addInitScript(() => {
      const played: string[] = [];
      const started: number[] = [];
      Object.assign(window, { audioVerification: { played, started } });
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        return play.call(this).then(() => { played.push(new URL(this.currentSrc || this.src).pathname); });
      };
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
        start.apply(this, args);
        if (this.buffer && !this.loop) started.push(this.buffer.duration);
      };
    });
    await page.goto("/");
    await page.locator('.console-environment[data-boot="home"]').waitFor();
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => page.evaluate(() => (window as any).audioVerification.played)).toContain("/audio/cursor.mp3");
    await page.getByRole("button", { name: "Audio settings. Press and hold to replay the boot sequence.", exact: true }).click();
    const bootResponse = page.waitForResponse(response => response.url().endsWith("/audio/start.mp3") && response.request().method() === "GET");
    await page.getByRole("button", { name: "Replay the boot sequence", exact: true }).click();
    expect((await bootResponse).ok()).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).audioVerification.started.some((duration: number) => duration > 1))).toBe(true);
    await page.locator('.console-environment[data-boot="home"]').waitFor();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("theme-settings")).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).audioVerification.played)).toContain("/audio/select.mp3");
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => (window as any).audioVerification.played)).toContain("/audio/cancel.mp3");
  });

  test("status panel keeps dated counts offline and offers search from Options", async ({ page }) => {
    await skipBoot(page);
    await page.goto("/");
    const status = page.getByRole("region", { name: "Console status" });
    await expect(status.locator(".console-status-friends")).toHaveText(String(statsSnapshot.watchers ?? "—"));
    await expect(status.locator(".console-status-commits")).toHaveText(String(statsSnapshot.commits ?? "—"));
    await expect(status.locator(".console-status-friends")).toHaveAttribute("title", /Last GitHub update:/);
    await expect(status.locator(".console-status-busy")).toHaveAttribute("data-active", "false");
    await page.getByRole("button", { name: "Options, triangle button", exact: true }).click();
    await page.getByRole("button", { name: "Search all destinations", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Search destinations" })).toBeVisible();
  });

  test("status panel preserves zero watchers and a single-commit repository", async ({ page }) => {
    await skipBoot(page);
    await page.route("https://api.github.com/repos/oakvx/yag", route => route.fulfill({ json: { subscribers_count: 0, watchers_count: 500 } }));
    await page.route("https://api.github.com/repos/oakvx/yag/commits?per_page=1", route => route.fulfill({ json: [{ sha: "b".repeat(40) }] }));
    await page.goto("/");
    const status = page.getByRole("region", { name: "Console status" });
    await expect(status.getByLabel("Friends: 0 GitHub watchers")).toHaveText("0");
    await expect(status.getByRole("button", { name: /1 total commits/ })).toHaveText("1");
  });

  test("status panel uses real watchers and the full commit count", async ({ page }) => {
    await skipBoot(page);
    await page.route("https://api.github.com/repos/oakvx/yag", route => route.fulfill({
      json: { subscribers_count: 7, watchers_count: 999, stargazers_count: 999 },
    }));
    await page.route("https://api.github.com/repos/oakvx/yag/commits?per_page=1", route => route.fulfill({
      json: [{ sha: "a".repeat(40) }],
      headers: {
        "access-control-expose-headers": "Link",
        link: '<https://api.github.com/repos/oakvx/yag/commits?per_page=1&page=846>; rel="last"',
      },
    }));
    await page.goto("/");
    const status = page.getByRole("region", { name: "Console status" });
    await expect(status.getByLabel("Friends: 7 GitHub watchers")).toHaveText("7");
    await expect(status.getByRole("button", { name: /846 total commits/ })).toHaveText("846");
    await expect(status.locator(".console-battery, .console-status-controller, .console-status-wifi, .console-search-toggle")).toHaveCount(0);
    await expect(status).not.toContainText(/Battery|WebGL|1000BASE/);
    await status.getByRole("button", { name: /846 total commits/ }).click();
    await expect(page.locator(".console-notice-panel")).toHaveAttribute("data-open", "true");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("textbox", { name: "Search destinations" })).toBeVisible();
  });

  test("a first visit boots the console, exactly as before", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await expect(page).toHaveTitle("YAG | Cross Media Environment");
    await expect(page.locator(".console-environment")).toBeVisible();
    // The boot film starts on its own, as the original does; audio waits for the first gesture.
    await expect(page.locator('.boot-screen[data-running="true"]')).toBeVisible();
    await expect(page.locator(".workspace")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the menu, its documents and the quick-jump palette work unchanged", async ({ page }) => {
    await skipBoot(page);
    await page.goto("/");
    await expect(page.locator(".console-environment")).toHaveAttribute("data-surface", "menu");
    await expect(page).toHaveTitle("YAG | Cross Media Environment");
    await expect(page.locator(".console-item-subtitle")).toHaveCount(0);
    await page.keyboard.press("Control+k");
    const search = page.getByRole("textbox", { name: "Search destinations" });
    await search.fill("Trophies");
    await expect(page.locator(".console-quick-result").first()).not.toContainText("TRO");
    await search.fill("Architecture");
    await page.keyboard.press("Enter");
    await expect(page.locator(".console-environment")).toHaveAttribute("data-surface", "app");
    await expect(page.locator(".xmb-masthead-title")).toBeVisible();
    await page.getByRole("button", { name: "H2 Pre-Body Auth & Scopes", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Pre-Body Auth & Scopes", exact: true })).toBeVisible();
  });

  test("deep links to console documents still open inside the console", async ({ page }) => {
    await skipBoot(page);
    for (const path of ["/routing", "/deploy?view=configuration", "/theme", "/trophies"]) {
      await page.goto(path);
      await expect(page.locator(".console-environment")).toHaveAttribute("data-surface", "app");
      await expect(page.locator(".workspace")).toHaveCount(0);
    }
    await expect(page.getByTestId("trophies")).toBeVisible();
  });

  test("trophy collection summarizes earned progress and grades", async ({ page }) => {
    await skipBoot(page);
    await page.addInitScript(() => localStorage.setItem("yag-xmb-trophies-v1", JSON.stringify({
      unlocked: { boot: 1, opener: 2, atmosphere: 3 },
      visited: [],
    })));
    await page.goto("/trophies");
    const progress = page.getByRole("progressbar", { name: "Trophy collection progress" });
    await expect(progress).toHaveAttribute("aria-valuenow", "3");
    await expect(progress).toHaveAttribute("aria-valuetext", "3 of 11 trophies unlocked");
    await expect(page.locator('.xmb-list-row[data-tone="silver"]')).toHaveCount(2);
    const artwork = page.locator(".xmb-list-image img");
    await expect(artwork).toHaveCount(11);
    await expect.poll(() => artwork.evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth === 240))).toBe(true);
    await expect(page.getByRole("complementary", { name: "Selected trophy details" }).getByRole("heading", { name: "Cold Start" })).toBeVisible();
  });

  test("theme picker distinguishes the saved atmosphere from its preview", async ({ page }) => {
    await skipBoot(page);
    await page.addInitScript(() => localStorage.setItem("yag-xmb-theme-v1", "9"));
    await page.goto("/theme");
    const ice = page.locator('[data-testid="theme-settings"] .xmb-list-row').filter({ hasText: "Ice" });
    const ember = page.locator('[data-testid="theme-settings"] .xmb-list-row').filter({ hasText: "Ember" });
    const palette = page.getByRole("complementary", { name: "Selected wallpaper palette" });
    await expect(ember).toContainText("Active");
    await ice.hover();
    await expect(ice).toContainText("Preview");
    await expect(ember).toContainText("Saved");
    await expect(palette.getByRole("heading", { name: "Ice" })).toBeVisible();
  });

  test("console collection panels do not overflow on mobile", async ({ page }) => {
    await skipBoot(page);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [path, testId] of [["/theme", "theme-settings"], ["/trophies", "trophies"]]) {
      await page.goto(path);
      await expect(page.getByTestId(testId)).toBeVisible();
      const size = await page.locator(".console-application-content").evaluate((element) => ({
        client: element.clientWidth,
        scroll: element.scrollWidth,
      }));
      expect(size.scroll, `Horizontal overflow on ${path}`).toBeLessThanOrEqual(size.client);
    }
  });

  test("Workspace View is available by URL and returns to the console", async ({ page }) => {
    await skipBoot(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("link", { name: "Workspace View", exact: true })).toHaveCount(0);
    await openWorkspace(page);
    await expect(page.locator(".workspace")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Your models.");
    await page.getByRole("button", { name: "Return to console", exact: true }).click();
    await expect(page.locator(".console-environment")).toHaveAttribute("data-surface", "menu");
    await expect(page.locator(".workspace")).toHaveCount(0);
  });

  test("workspace logo uses the supplied PS4 display font", async ({ page }) => {
    await openWorkspace(page);
    const wordmark = page.locator(".sidebar-brand > span");
    await expect.poll(() => wordmark.evaluate((element) => getComputedStyle(element).fontFamily)).toContain("YAG Logo");
  });

  test("a reload after leaving the workspace lands back in the console", async ({ page }) => {
    await skipBoot(page);
    await openWorkspace(page);
    await page.getByRole("link", { name: "Architecture", exact: true }).click();
    await expect(page).toHaveURL(/\/architecture$/);
    await page.reload();
    await expect(page.locator(".console-environment")).toHaveAttribute("data-surface", "app");
    await expect(page.locator(".workspace")).toHaveCount(0);
  });
});

test.describe("Workspace View (optional reading mode)", () => {
  test("direct links retain document parameters and the existing typefaces", async ({ page }) => {
    await openWorkspace(page, "/deploy?view=configuration");
    await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText("Configuration");
    await openWorkspace(page, "/?view=system");
    await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText("System information");
    const fonts = await page.locator(".workspace").evaluate((element) => {
      const actual = getComputedStyle(element);
      const existing = getComputedStyle(document.documentElement);
      return ["--font-sans", "--font-serif", "--font-mono", "--font-xmb"].map(name => ({
        name, actual: actual.getPropertyValue(name).trim(), existing: existing.getPropertyValue(name).trim(),
      }));
    });
    for (const font of fonts) expect(font.actual, font.name).toBe(font.existing);
    expect(await page.evaluate(() => performance.getEntriesByType("resource").map(entry => entry.name)))
      .not.toEqual(expect.arrayContaining([expect.stringMatching(/geist-|plex-mono/)]));
  });

  test("renders without runtime errors and marks the current page", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openWorkspace(page);
    await expect(page).toHaveTitle("Workspace View | YAG — Yet Another Gateway");
    await expect(page.locator(".explore-card")).toHaveCount(3);
    await expect(page.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");
    expect(errors).toEqual([]);
  });

  test("diagram, protocol tabs, language and clipboard stay in sync", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openWorkspace(page);
    await page.getByRole("button", { name: "Inspect Anthropic protocol", exact: true }).click();
    const anthropic = page.getByRole("tab", { name: "Anthropic Messages", exact: true });
    await expect(anthropic).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".snippet-endpoint")).toHaveText("/v1/messages");
    await anthropic.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Responses", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByLabel("Example language").selectOption("python");
    await expect(page.locator(".request-snippet")).toContainText("import os, requests");
    await page.getByRole("button", { name: "Copy request example", exact: true }).click();
    await expect(page.getByRole("button", { name: "Code copied", exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("/v1/responses");
  });

  test("copying degrades honestly when the clipboard is unavailable", async ({ page }) => {
    await openWorkspace(page);
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("Clipboard permission denied")) },
    }));
    await page.getByRole("button", { name: "Copy request example", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Clipboard unavailable");
    expect(await page.evaluate(() => window.getSelection()?.toString())).toContain("/v1/chat/completions");
  });

  test("navigation and browser history work inside the workspace", async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole("link", { name: "Explore the gateway", exact: true }).click();
    await expect(page).toHaveURL(/\/architecture$/);
    await expect(page.locator(".xmb-masthead-title")).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Your models.");
    await page.goForward();
    await expect(page.locator(".xmb-masthead-title")).toBeVisible();
  });

  test("quick search filters, reports empty results and navigates", async ({ page }) => {
    await openWorkspace(page);
    await page.keyboard.press("Control+k");
    const search = page.getByRole("textbox", { name: "Search destinations" });
    await expect(search).toBeFocused();
    await search.fill("no-such-destination-83924");
    await expect(page.getByText("Nothing matches.", { exact: true })).toBeVisible();
    await search.fill("Model Routing");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/routing$/);
    await expect(page.getByPlaceholder("Type a model ID...")).toBeVisible();
    await page.keyboard.press("Control+k");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Jump to a destination" })).toHaveCount(0);
  });

  test("the original simulators remain interactive", async ({ page }) => {
    await openWorkspace(page, "/routing");
    await page.getByRole("button", { name: "TCP Connect Refused", exact: true }).click();
    await page.getByRole("checkbox", { name: "YAG_FALLBACK_TO_DEFAULT=0" }).check();
    await expect(page.getByRole("checkbox", { name: "YAG_FALLBACK_TO_DEFAULT=1" })).toBeChecked();
    await page.getByRole("link", { name: "Request lifecycle", exact: true }).click();
    await expect(page.getByRole("button", { name: /Prev/ })).toBeDisabled();
    await page.getByRole("button", { name: /Next/ }).click();
    await expect(page.getByRole("button", { name: /Prev/ })).toBeEnabled();
    await page.getByRole("link", { name: "Deployment", exact: true }).click();
    await page.getByRole("button", { name: /Colibri LAN Hub/ }).click();
    await expect(page.locator(".workspace-tool")).toContainText("python scripts/lan.py init");
  });

  test("appearance settings support keyboard control and persist locally", async ({ page }) => {
    await openWorkspace(page, "/theme");
    await page.getByRole("radio", { name: /Evergreen/ }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: /Glacier/ })).toBeChecked();
    await expect(page.locator(".workspace")).toHaveAttribute("data-accent", "ice");
    await page.getByRole("switch", { name: "Interface motion", exact: true }).click();
    await expect(page.locator(".workspace")).toHaveAttribute("data-motion", "off");
    await openWorkspace(page, "/theme");
    await expect(page.getByRole("radio", { name: /Glacier/ })).toBeChecked();
    await expect(page.getByRole("switch", { name: "Interface motion", exact: true })).not.toBeChecked();
  });

  test("repository activity shows real bundled commits", async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole("button", { name: "Repository activity", exact: true }).click();
    await expect(page.locator(".activity-entry")).toHaveCount(4);
    await expect(page.locator(".activity-entry").first()).toHaveAttribute("href", /github.com\/oakvx\/yag\/commit\/[a-f0-9]+$/);
    await page.keyboard.press("Escape");
    await expect(page.locator(".activity-popover")).toHaveCount(0);
  });

  test("passes automated WCAG A and AA checks", async ({ page }) => {
    await openWorkspace(page);
    await expect(page.locator(".gateway-figure")).toHaveCSS("opacity", "1");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(results.violations).toEqual([]);
  });

  test("mobile navigation works and no page overflows horizontally", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWorkspace(page);
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page.getByRole("link", { name: "Security", exact: true }).click();
    await expect(page).toHaveURL(/\/security$/);
    await expect(page.locator(".workspace-sidebar")).not.toHaveClass(/is-open/);
    for (const path of ["/", "/architecture", "/lifecycle", "/protocols", "/source", "/deploy?view=configuration", "/status", "/profile", "/trophies", "/?view=system"]) {
      await openWorkspace(page, path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      const size = await page.locator("main").evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
      expect(size.scroll, `Horizontal overflow on ${path}`).toBeLessThanOrEqual(size.client);
    }
  });

  test("reduced-motion system preferences take priority", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openWorkspace(page);
    await expect(page.locator(".workspace")).toHaveAttribute("data-motion", "off");
    await expect(page.locator(".gateway-chip")).toHaveCSS("animation-name", "none");
  });
});
