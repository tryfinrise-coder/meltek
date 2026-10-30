import { Modal, ModalBody, ModalFooter, ModalHeader } from 'flowbite-react';
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../shared/api';
import { TextField } from '../shared/fields';
import { Button, Callout } from '../shared/primitives';

/** Change your own password. Every other session is signed out on success. */
export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) { setCurrent(''); setNext(''); setConfirm(''); setDone(false); }
  }, [open]);

  const change = useMutation({
    mutationFn: () => api.changePassword({ currentPassword, newPassword }),
    onSuccess: () => setDone(true),
  });

  const mismatch = confirm !== '' && confirm !== newPassword;
  const ready = currentPassword !== '' && newPassword.length >= 12 && confirm === newPassword;

  return (
    <Modal show={open} onClose={onClose} size="md" dismissible>
      <ModalHeader className="border-[var(--line)] [&>h3]:text-[15px] [&>h3]:font-semibold">
        Change password
      </ModalHeader>
      <form onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
        <ModalBody className="bg-[var(--surface-1)]">
          {done ? (
            <Callout tone="ok" title="Password changed">
              Anywhere else you were signed in has been signed out.
            </Callout>
          ) : (
            <div className="flex flex-col gap-3">
              <TextField
                label="Current password" type="password" autoComplete="current-password"
                value={currentPassword} onChange={(e) => setCurrent(e.target.value)}
              />
              <TextField
                label="New password" type="password" autoComplete="new-password"
                value={newPassword} onChange={(e) => setNext(e.target.value)}
                help="At least 12 characters."
              />
              <TextField
                label="Confirm new password" type="password" autoComplete="new-password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
                {...(mismatch ? { error: 'The two passwords do not match.' } : {})}
              />
              {change.error instanceof ApiError && (
                <Callout tone="warn" title="Could not change your password">
                  {change.error.message}
                </Callout>
              )}
            </div>
          )}
        </ModalBody>
        <ModalFooter className="justify-end border-[var(--line)] bg-[var(--surface-1)]">
          {done ? (
            <Button variant="primary" onClick={onClose}>Close</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={!ready || change.isPending}>
                {change.isPending ? 'Changing…' : 'Change password'}
              </Button>
            </>
          )}
        </ModalFooter>
      </form>
    </Modal>
  );
}
