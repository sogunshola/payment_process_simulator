export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-shimmer rounded-control bg-white/10 ${className}`} />;
}
