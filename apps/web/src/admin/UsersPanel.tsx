import { useState } from 'react';
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'flowbite-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HiPencil, HiPlus, HiTrash } from 'react-icons/hi';
import { ROLES, ROLE_DESCRIPTION, ROLE_LABEL, type Role } from '@meltek/schema';
import { api, ApiError, type AccountUser } from '../shared/api';
import { useCurrentUser } from '../auth/session';
import { SelectField, TextField } from '../shared/fields';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { Badge, Button, Callout, Card, Skeleton } from '../shared/primitives';

const ROLE_TONE: Record<Role, 'neutral' | 'info' | 'ok' | 'brand'> = {
  viewer: 'neutral',
  engineer: 'info',
  approver: 'ok',
  admin: 'brand',
};

/** Account administration. Only an administrator can reach this. */
export function UsersPanel() {
  const qc = useQueryClient();
  const me = useCurrentUser();
  const users = useQuery({ queryKey: ['users'], queryFn: api.users });
  const [dialog, setDialog] = useState<{ mode: 'add' } | { mode: 'edit'; user: AccountUser } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AccountUser | null>(null);

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['users'] }); };

  const remove = useMutation({
    mutationFn: (u: AccountUser) => api.deleteUser(u.id),
    onSuccess: () => { refresh(); setPendingDelete(null); },
  });

  const setActive = useMutation({
    mutationFn: ({ u, isActive }: { u: AccountUser; isActive: boolean }) =>
      api.updateUser(u.id, { isActive }),
    onSuccess: refresh,
  });

  const rows = users.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Accounts"
        subtitle="Who can sign in, and what each of them may do. Every design records the account that raised, calculated and approved it."
        actions={
          <Button size="sm" variant="primary" onClick={() => setDialog({ mode: 'add' })}>
            <HiPlus className="mr-1.5 h-4 w-4" aria-hidden /> Add account
          </Button>
        }
      >
        {users.isLoading && <div className="p-5"><Skeleton className="h-24 w-full" /></div>}

        {setActive.error instanceof ApiError && (
          <div className="px-5 pt-4">
            <Callout tone="warn" title="That change was refused">{setActive.error.message}</Callout>
          </div>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="data-table w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--line-strong)] text-left">
                  {['Name', 'Email', 'Role', 'Status', 'Last signed in', ''].map((h, i) => (
                    <th key={h || `a-${i}`} className="label px-4 py-2 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const isSelf = u.id === me?.id;
                  // The built-in administrator is the way back in, so the controls that
                  // would strand the works are disabled rather than shown and refused.
                  const locked = u.isProtected;
                  return (
                    <tr key={u.id} className="border-b border-[var(--line)]">
                      <td className="px-4 py-2.5 font-medium">
                        {u.name}
                        {isSelf && <span className="ml-2 text-[11px] text-[var(--text-3)]">you</span>}
                        {locked && (
                          <span className="ml-2 align-middle"><Badge tone="info">built-in</Badge></span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-2)]">{u.email}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        {u.isActive
                          ? <Badge tone="ok">active</Badge>
                          : <Badge tone="warn">disabled</Badge>}
                      </td>
                      <td className="px-4 py-2.5 num text-[var(--text-3)]">
                        {u.lastSignInAt ? u.lastSignInAt.replace('T', ' ').slice(0, 16) : 'never'}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <Button size="xs" title={`Edit ${u.name}`} onClick={() => setDialog({ mode: 'edit', user: u })}>
                            <HiPencil className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                          <Button
                            size="xs"
                            title={locked
                              ? 'The built-in administrator cannot be disabled'
                              : isSelf
                                ? 'You cannot disable your own account'
                                : u.isActive ? 'Disable, signing them out everywhere' : 'Re-enable'}
                            disabled={isSelf || locked}
                            onClick={() => setActive.mutate({ u, isActive: !u.isActive })}
                          >
                            {u.isActive ? 'Disable' : 'Enable'}
                          </Button>
                          <Button
                            size="xs"
                            title={locked
                              ? 'The built-in administrator cannot be deleted'
                              : isSelf ? 'You cannot delete your own account' : `Delete ${u.name}`}
                            disabled={isSelf || locked}
                            onClick={() => setPendingDelete(u)}
                          >
                            <HiTrash className="h-3.5 w-3.5" aria-hidden style={{ color: 'var(--warn)' }} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="The built-in administrator">
        <div className="measure flex flex-col gap-2 p-5 text-[13px] text-[var(--text-2)]">
          <p>
            One account is marked <Badge tone="info">built-in</Badge> and is recreated at
            startup if it ever goes missing. It cannot be deleted, given another role or
            disabled, so the works can always get back in after a lost password.
          </p>
          <p>
            Its name, email and password <em>are</em> changeable — and its password should be
            changed from whatever it was created with.
          </p>
        </div>
      </Card>

      <Card title="What each role may do">
        <ul className="divide-y divide-[var(--line)]">
          {ROLES.map((role) => (
            <li key={role} className="flex flex-col gap-1 px-5 py-3 md:flex-row md:items-baseline md:gap-4">
              <span className="w-32 shrink-0">
                <Badge tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Badge>
              </span>
              <span className="measure text-[13px] text-[var(--text-2)]">{ROLE_DESCRIPTION[role]}</span>
            </li>
          ))}
        </ul>
      </Card>

      <UserDialog
        key={dialog?.mode === 'edit' ? dialog.user.id : 'add'}
        open={dialog !== null}
        user={dialog?.mode === 'edit' ? dialog.user : null}
        onClose={() => setDialog(null)}
        onSaved={refresh}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => { if (pendingDelete) remove.mutate(pendingDelete); }}
        title={pendingDelete ? `Delete ${pendingDelete.name}?` : 'Delete account'}
        confirmLabel="Delete account"
        busy={remove.isPending}
        error={remove.error instanceof ApiError ? remove.error.message : null}
      >
        <p>
          They will be signed out and will no longer be able to sign in. Designs they worked
          on keep their name in the history.
        </p>
        <p>To keep the record but stop access, disable the account instead.</p>
      </ConfirmDialog>
    </div>
  );
}

function UserDialog({
  open, onClose, onSaved, user,
}: { open: boolean; onClose: () => void; onSaved: () => void; user: AccountUser | null }) {
  const editing = Boolean(user);
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'engineer');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = editing
    ? name.trim() !== '' && email.trim() !== '' && (password === '' || password.length >= 12)
    : name.trim() !== '' && email.trim() !== '' && password.length >= 12;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api.updateUser(user!.id, {
          name: name.trim(),
          email: email.trim(),
          role,
          ...(password ? { password } : {}),
        });
      } else {
        await api.createUser({ name: name.trim(), email: email.trim(), role, password });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The account could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={open} onClose={onClose} size="lg" dismissible>
      <ModalHeader className="border-[var(--line)] [&>h3]:text-[15px] [&>h3]:font-semibold">
        {editing ? `Edit ${user!.name}` : 'Add an account'}
      </ModalHeader>
      <ModalBody className="bg-[var(--surface-1)]">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <TextField label="Email" type="email" value={email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
          </div>

          <SelectField
            label="Role" value={role} disabled={user?.isProtected}
            onChange={(e) => setRole(e.target.value as Role)}
            {...(user?.isProtected
              ? { help: 'The built-in administrator always stays an administrator.' }
              : {})}
          >
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </SelectField>
          <p className="text-[12px] text-[var(--text-3)]">{ROLE_DESCRIPTION[role]}</p>

          <TextField
            label={editing ? 'Set a new password' : 'Password'}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            help={editing
              ? 'Leave blank to keep the current one. Setting a new one signs them out everywhere.'
              : 'At least 12 characters. Pass it to them directly and have them change it.'}
          />

          {editing && (
            <Callout tone="info" title="Changes take effect at once">
              A new role or password ends their current sessions, so they sign in again under
              the new setting rather than at some later point.
            </Callout>
          )}

          {error && <Callout tone="warn" title="That did not save">{error}</Callout>}
        </div>
      </ModalBody>
      <ModalFooter className="justify-end border-[var(--line)] bg-[var(--surface-1)]">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={!ready || busy}>
          {busy ? 'Saving…' : editing ? 'Save account' : 'Add account'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
