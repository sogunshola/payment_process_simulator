const KEY = 'arena:best-scores';
const MAX = 5;

export interface BestEntry {
  score: number;
  stars: number;
  date: string;
}

function isEntry(v: unknown): v is BestEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.score === 'number' && typeof e.stars === 'number' && typeof e.date === 'string';
}

// localStorage can throw (blocked site data) or hold junk; both mean "no scores", never a crash.
export function loadBest(): BestEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isEntry).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function saveBest(entry: BestEntry): BestEntry[] {
  const next = [...loadBest(), entry].sort((a, b) => b.score - a.score).slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // keep going; the report still shows this run's entry
  }
  return next;
}
