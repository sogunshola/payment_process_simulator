import type { HTMLAttributes } from 'react';

// Glass surface: translucent fill + blur + hairline border.
export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={`rounded-card border border-line bg-surface p-6 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] backdrop-blur-md ${className}`}
    />
  );
}
