export const REPOSITORY_API = "https://api.github.com/repos/oakvx/yag";

export interface RepositoryStats {
  commits: number | null;
  watchers: number | null;
  updatedAt: string | null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** per_page=1 makes the last page number the total, including merge commits. */
export function countCommits(rows: unknown, link: string | null): number {
  if (!Array.isArray(rows) || rows.length > 1 || rows.some(row => typeof row?.sha !== "string")) {
    throw new Error("Invalid commit response");
  }
  const last = link?.match(/<([^>]+)>;\s*rel="last"/);
  if (last) {
    const url = new URL(last[1]);
    const page = Number(url.searchParams.get("page"));
    if (url.origin !== "https://api.github.com" || url.searchParams.get("per_page") !== "1" || !isCount(page) || page < 1 || rows.length !== 1) {
      throw new Error("Invalid commit pagination");
    }
    return page;
  }
  if (link) throw new Error("Commit total unavailable");
  return rows.length;
}

/** Public, credential-free requests. Never confuse GitHub stars with watchers. */
export async function fetchRepositoryStats(): Promise<RepositoryStats> {
  const options = { headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(8000) };
  const [repo, commits] = await Promise.all([
    fetch(REPOSITORY_API, options),
    fetch(`${REPOSITORY_API}/commits?per_page=1`, options),
  ]);
  if (!repo.ok || !commits.ok) throw new Error("Repository statistics unavailable");
  const metadata = await repo.json();
  if (!isCount(metadata?.subscribers_count)) throw new Error("Watcher count unavailable");
  return {
    watchers: metadata.subscribers_count,
    commits: countCommits(await commits.json(), commits.headers.get("link")),
    updatedAt: new Date().toISOString(),
  };
}
