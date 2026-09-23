export function formatDelta(delta: number | null | undefined): string {
  if (delta === null || delta === undefined) return "—";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta} pts`;
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function truncateHash(hash: string | undefined, chars = 12): string {
  if (!hash) return "";
  if (hash.length <= chars) return hash;
  return `${hash.slice(0, chars)}...`;
}
