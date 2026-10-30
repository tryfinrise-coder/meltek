import { Modal, ModalBody, ModalFooter, ModalHeader, TextInput } from 'flowbite-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Callout } from './primitives';

/**
 * Confirmation before anything that cannot be undone.
 *
 * Deletes say what will go with the record, and a destructive one can require the name
 * to be typed. Nothing here is a generic "Are you sure?" — the operator is told exactly
 * what is about to happen (§16).
 */
export function ConfirmDialog({
  open, onClose, onConfirm, title, children, confirmLabel = 'Delete',
  tone = 'warning', busy, error, typeToConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  tone?: 'warning' | 'primary';
  busy?: boolean;
  error?: string | null;
  /** When set, the operator must type this exactly before the action is enabled. */
  typeToConfirm?: string;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => { if (open) setTyped(''); }, [open]);

  const armed = !typeToConfirm || typed.trim() === typeToConfirm;

  return (
    <Modal show={open} onClose={onClose} size="md" dismissible>
      <ModalHeader className="border-[var(--line)] [&>h3]:text-[15px] [&>h3]:font-semibold">
        {title}
      </ModalHeader>
      <ModalBody className="bg-[var(--surface-1)]">
        <div className="flex flex-col gap-4 text-[14px] text-[var(--text-2)]">
          {children}
          {typeToConfirm && (
            <label className="flex flex-col gap-1.5">
              <span className="label">
                Type <span className="mono text-[var(--text)]">{typeToConfirm}</span> to confirm
              </span>
              <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
            </label>
          )}
          {error && <Callout tone="warn" title="That did not work">{error}</Callout>}
        </div>
      </ModalBody>
      <ModalFooter className="justify-end border-[var(--line)] bg-[var(--surface-1)]">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          variant={tone === 'warning' ? 'primary' : 'primary'}
          onClick={onConfirm}
          disabled={busy || !armed}
        >
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
