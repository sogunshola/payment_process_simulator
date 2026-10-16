import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '../ui/Button';
import { ConnectionIndicator } from './ConnectionIndicator';
import { SettingsDialog } from './SettingsDialog';

const links = [
  { to: '/', label: 'Console', end: true },
  { to: '/arena', label: 'Chaos Arena', end: false },
];

export function TopNav() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/70 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-page items-center justify-between gap-4 px-gutter">
        <div className="flex items-center gap-8">
          <span className="font-mono text-sm font-medium tracking-tight">
            <span className="text-accent">&gt;</span> payments
          </span>
          <nav aria-label="Primary" className="flex items-center gap-1">
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
        </div>
        <div className="flex items-center gap-4">
          <ConnectionIndicator />
          <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)}>
            Settings
          </Button>
        </div>
      </div>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
