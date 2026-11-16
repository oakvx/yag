import assert from "node:assert/strict";
import test from "node:test";
import { countCommits, fetchRepositoryStats } from "../src/xmb/repositoryStats.ts";

const row = [{ sha: "a".repeat(40) }];
test("the full history comes from the last page, not the returned page length", () => {
  assert.equal(countCommits(row, '<https://api.github.com/repositories/123/commits?per_page=1&page=2>; rel="next", <https://api.github.com/repositories/123/commits?per_page=1&page=846>; rel="last"'), 846);
  assert.equal(countCommits(row, null), 1);
  assert.equal(countCommits([], null), 0);
});

test("incomplete or malformed pagination never becomes a plausible false total", () => {
  for (const link of [
    '<https://api.github.com/repos/oakvx/yag/commits?per_page=1&page=2>; rel="next"',
    '<https://api.github.com/repos/oakvx/yag/commits?per_page=100&page=2>; rel="last"',
    '<https://api.github.com/repos/oakvx/yag/commits?per_page=1&page=-2>; rel="last"',
  ]) assert.throws(() => countCommits(row, link));
  assert.throws(() => countCommits({ message: "API rate limit exceeded" }, null));
});

test("watchers use subscribers_count, including zero, never the legacy stars field", async t => {
  t.mock.method(globalThis, "fetch", async url => new Response(JSON.stringify(String(url).includes("/commits?") ? row : { subscribers_count: 0, watchers_count: 999 })));
  const stats = await fetchRepositoryStats();
  assert.equal(stats.watchers, 0);
  assert.equal(stats.commits, 1);
  assert.ok(Number.isFinite(Date.parse(stats.updatedAt)));
});

test("missing watcher data and API limits are failures, not zero counts", async t => {
  const mock = t.mock.method(globalThis, "fetch", async url => new Response(JSON.stringify(String(url).includes("/commits?") ? row : { watchers_count: 999 })));
  await assert.rejects(fetchRepositoryStats(), /Watcher count unavailable/);
  mock.mock.mockImplementation(async () => new Response('{}', { status: 403 }));
  await assert.rejects(fetchRepositoryStats(), /statistics unavailable/);
});
