import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { getSettings, saveSettings } from '../../lib/api/settings';

function SettingsForm({ onClose }: { onClose: () => void }) {
  const initial = getSettings();
  const [apiUrl, setApiUrl] = useState(initial.apiUrl);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [reveal, setReveal] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();

  function submit(e: FormEvent) {
    e.preventDefault();
    saveSettings({ apiUrl, apiKey });
    // Cached data may belong to the old URL or key, so refetch everything.
    void qc.invalidateQueries();
    toast.show('success', 'Settings saved');
    onClose();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Input
        label="API URL"
        value={apiUrl}
        onChange={(e) => setApiUrl(e.target.value)}
        hint="Default /api uses the dev proxy to localhost:3000."
        autoComplete="off"
      />
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="API key"
            type={reveal ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
        </div>
        <Button variant="secondary" aria-pressed={reveal} onClick={() => setReveal((r) => !r)}>
          {reveal ? 'Hide' : 'Show'}
        </Button>
      </div>
      <p className="text-xs text-muted">Values last only for this browser tab session.</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Connection settings">
      <SettingsForm onClose={onClose} />
    </Modal>
  );
}
