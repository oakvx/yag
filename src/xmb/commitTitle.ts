/** Merge subjects are transport metadata; the PR title is the first body line. */
export function cleanCommitTitle(subject?: string, body?: string): string {
  const clean = (text: string) => {
    const line = text.trim().split(/\r?\n/, 1)[0] ?? "";
    if (/^Merge\s+(?:branch|remote-tracking branch|tag)\b/i.test(line)) return "";
    return line.replace(/^Merge pull request #\d+ from \S+\s*[:–—-]?\s*/i, "")
      .replace(/^(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([^)]*\))?!?:\s*/i, "").trim();
  };
  return clean(subject ?? "") || clean(body ?? "") || "No news";
}
