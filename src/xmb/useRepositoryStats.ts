import { useEffect, useState } from "react";
import snapshot from "@/data/repository-stats.generated.json";
import { fetchRepositoryStats, type RepositoryStats } from "./repositoryStats";

const REFRESH_MS = 5 * 60 * 1000;
let latest: RepositoryStats = snapshot;
let nextRefresh = 0;
let pending: Promise<RepositoryStats> | null = null;

function refresh() {
  if (pending) return pending;
  if (Date.now() < nextRefresh) return Promise.resolve(latest);
  nextRefresh = Date.now() + REFRESH_MS;
  pending = fetchRepositoryStats()
    .then(stats => { latest = stats; return stats; })
    .catch(() => latest)
    .finally(() => { pending = null; });
  return pending;
}

export function useRepositoryStats() {
  const [stats, setStats] = useState(latest);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let disposed = false;
    const update = async () => {
      if (document.visibilityState === "hidden") return;
      setLoading(Date.now() >= nextRefresh || pending !== null);
      const result = await refresh();
      if (!disposed) { setStats(result); setLoading(false); }
    };
    void update();
    const timer = window.setInterval(update, REFRESH_MS);
    document.addEventListener("visibilitychange", update);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return { stats, loading };
}
