export interface Settings {
  apiUrl: string;
  apiKey: string;
}

const STORAGE_KEY = 'payments-console:settings';
const DEFAULTS: Settings = { apiUrl: '/api', apiKey: '' };

// sessionStorage can throw (blocked site data, private modes), so the app must
// still work with in-memory settings when it does.
let memory: Settings = { ...DEFAULTS };
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        const p = parsed as Partial<Settings>;
        memory = {
          apiUrl: typeof p.apiUrl === 'string' && p.apiUrl ? p.apiUrl : DEFAULTS.apiUrl,
          apiKey: typeof p.apiKey === 'string' ? p.apiKey : DEFAULTS.apiKey,
        };
      }
    }
  } catch {
    // fall through to the in-memory copy
  }
  return memory;
}

export function saveSettings(next: Settings): void {
  memory = { apiUrl: next.apiUrl.trim() || DEFAULTS.apiUrl, apiKey: next.apiKey.trim() };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // keep the in-memory copy; the values just will not survive a reload
  }
  listeners.forEach((l) => l());
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
