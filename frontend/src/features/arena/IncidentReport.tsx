import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import type { Report } from './game';

export function IncidentReport({ report, onPlayAgain, onClose }: { report: Report | null; onPlayAgain: () => void; onClose: () => void }) {
  const rows: [string, string][] = report
    ? [
        ['Score', String(report.score)],
        ['Success rate', report.successRate === null ? 'n/a' : `${Math.round(report.successRate * 100)}%`],
        ['Retries absorbed', String(report.retries)],
        ['Failures', String(report.failures)],
        ['Cancelled', String(report.cancelled)],
        ['Best score', report.demo ? 'not saved (demo)' : String(report.best[0]?.score ?? report.score)],
      ]
    : [];
  return (
    <Modal open={report !== null} onClose={onClose} title="Incident Report">
      {report && (
        <div className="flex flex-col gap-4">
          <p className={report.outcome === 'survived' ? 'text-status-succeeded' : 'text-status-failed'}>
            {report.outcome === 'survived' ? 'Survived' : `SLA breached at round ${report.round}`}
          </p>
          <p className="text-2xl" aria-label={`${report.stars} of 3 stars`}>
            {'★'.repeat(report.stars)}
            <span className="text-muted">{'★'.repeat(3 - report.stars)}</span>
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right font-mono">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted">Some payments may still be in flight; they are not counted.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button onClick={onPlayAgain}>Play again</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
