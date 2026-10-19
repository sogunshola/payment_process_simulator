import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { useToast } from '../../components/ui/Toast';
import { ApiError } from '../../lib/api/api-error';
import { useCreatePayment } from '../../lib/api/hooks';
import type { CreatePaymentInput, Currency } from '../../lib/api/types';
import { parseAmountToMinor } from '../../lib/money';

const CURRENCIES: Currency[] = ['NGN', 'USD', 'EUR', 'GBP'];
type Errors = Partial<Record<'amount' | 'currency' | 'description', string>>;

function PaymentForm({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('NGN');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const create = useCreatePayment();
  const toast = useToast();

  function submit(e: FormEvent) {
    e.preventDefault();
    // Each call gets a fresh Idempotency-Key, so a second submit would create a second payment.
    if (create.isPending) return;

    const next: Errors = {};
    const parsed = parseAmountToMinor(amount);
    if (!parsed.ok) next.amount = parsed.error;
    setErrors(next);
    setGeneral(null);
    if (!parsed.ok) return;

    const input: CreatePaymentInput = { amount: parsed.minor, currency };
    if (description.trim()) input.description = description.trim();

    create.mutate(input, {
      onSuccess: (p) => {
        toast.show('success', `Payment ${p.reference} created`);
        onClose();
      },
      onError: (err) => {
        if (err instanceof ApiError && Object.keys(err.fieldErrors).length > 0) {
          // Only known fields can be shown under an input; anything else falls back to the general message.
          const known: Errors = {};
          for (const f of ['amount', 'currency', 'description'] as const) {
            if (err.fieldErrors[f]) known[f] = err.fieldErrors[f];
          }
          setErrors(known);
          if (Object.keys(known).length > 0) return;
        }
        setGeneral(err.message);
      },
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <Input
          label="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={errors.amount}
          hint="In major units, for example 50.00"
          inputMode="decimal"
          autoComplete="off"
          required
        />
        <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} error={errors.currency}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>
      <Input
        label="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        error={errors.description}
        maxLength={256}
        autoComplete="off"
      />
      {general && (
        <p role="alert" className="text-sm text-status-failed">
          {general}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={create.isPending}>
          Create payment
        </Button>
      </div>
    </form>
  );
}

export function CreatePaymentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // The form lives inside the Modal, so closing unmounts it and the next open starts clean.
  return (
    <Modal open={open} onClose={onClose} title="New payment">
      <PaymentForm onClose={onClose} />
    </Modal>
  );
}
