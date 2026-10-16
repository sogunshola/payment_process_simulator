import type { ReactNode } from 'react';

interface Props {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: Props) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-card border border-dashed border-line p-8">
      <h3 className="text-base font-medium">{title}</h3>
      <p className="max-w-prose text-sm text-muted">{description}</p>
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
