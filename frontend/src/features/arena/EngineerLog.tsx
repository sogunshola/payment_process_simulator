import type { LogEntry, LogKind } from './game';

const tone: Record<LogKind, string> = {
  info: 'text-muted',
  good: 'text-status-succeeded',
  bad: 'text-status-failed',
  warn: 'text-status-pending',
};

export function EngineerLog({ entries }: { entries: LogEntry[] }) {
  return (
    <ol
      aria-label="Engineer log"
      aria-live="polite"
      // Scrollable regions need to be focusable, or keyboard users cannot scroll back through the log.
      tabIndex={0}
      className="flex h-64 flex-col gap-1 overflow-y-auto rounded-control font-mono text-xs"
    >
      {entries.length === 0 && <li className="text-muted">Nothing yet. Start a run.</li>}
      {entries.map((e) => (
        <li key={e.id} className={tone[e.kind]}>
          {e.text}
        </li>
      ))}
    </ol>
  );
}
