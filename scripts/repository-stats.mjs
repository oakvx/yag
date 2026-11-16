/** Bundle a dated fallback so the static site also works offline. Node 22.18+. */
import { writeFileSync } from "node:fs";
import { fetchRepositoryStats } from "../src/xmb/repositoryStats.ts";

try {
  const stats = await fetchRepositoryStats();
  writeFileSync(new URL("../src/data/repository-stats.generated.json", import.meta.url), JSON.stringify(stats, null, 2) + "\n");
  console.log(`[repository-stats] ${stats.commits} commits, ${stats.watchers} watchers`);
} catch {
  console.warn("[repository-stats] GitHub unavailable; keeping the existing dated snapshot");
}
