export function ChaosBanner({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div role="status" className="rounded-control border border-status-pending/50 bg-status-pending/10 px-4 py-3 text-sm text-status-pending">
      <strong className="font-semibold">Chaos active:</strong> gateway config modified. It will be restored on reset, pause or
      leaving this page. The config is global to the backend, so every client sees it.
    </div>
  );
}
