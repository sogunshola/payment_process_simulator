import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '../ui/Button';
import { ConnectionIndicator } from './ConnectionIndicator';

const links = [
  { to: '/', label: 'Console', end: true },
  { to: '/arena', label: 'Chaos Arena', end: false },
];

export function TopNav({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/70 backdrop-blur-md">
      {/*
        DOM order is brand, links, controls, which is also the desktop order. On a phone
        the links wrap onto their own row (order-last) so nothing overflows at 320px.
      */}
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 sm:px-gutter md:h-16 md:flex-nowrap md:py-0">
        <span className="font-mono text-sm font-medium tracking-tight md:mr-8">
          <span className="text-accent">&gt;</span> payments
        </span>
        <nav aria-label="Primary" className="order-last -mx-3 flex w-full items-center gap-1 md:order-none md:mx-0 md:mr-auto md:w-auto">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `relative rounded-control px-3 py-2 text-sm transition-colors ${isActive ? 'text-fg' : 'text-muted hover:text-fg'}`
              }
            >
              {({ isActive }) => (
                <>
                  {l.label}
                  {isActive && (
                    <motion.span
                      layoutId="nav-indicator"
                      className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent"
                    />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-3 sm:gap-4">
          <ConnectionIndicator />
          <Button variant="secondary" size="sm" onClick={onOpenSettings}>
            Settings
          </Button>
        </div>
      </div>
    </header>
  );
}
