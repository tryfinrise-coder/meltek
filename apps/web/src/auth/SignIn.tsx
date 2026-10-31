import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import { api, ApiError } from '../shared/api';
import { TextField } from '../shared/fields';
import { Button, Callout } from '../shared/primitives';
import { CoreIllustration } from '../shared/CoreIllustration';
import { Wordmark } from '../shared/Shell';
import { fadeUp } from '../shared/motion';

/**
 * Sign in, and first-run setup.
 *
 * The same screen covers both: on a fresh system there are no accounts, so it asks for
 * the first administrator instead of a password. That endpoint stops working the moment
 * an account exists, so this cannot be used to add one later.
 */
export function SignIn({ needsSetup }: { needsSetup: boolean }) {
  const reduce = useReducedMotion();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const submit = useMutation({
    mutationFn: () =>
      needsSetup
        ? api.setup({ name, email, password })
        : api.login({ email, password }),
    onSuccess: () => {
      // A full reload rather than a cache invalidation: it guarantees that nothing from
      // a previous session survives in memory, which matters when two people share a
      // machine on the works floor.
      qc.clear();
      window.location.assign('/');
    },
  });

  const error = submit.error instanceof ApiError ? submit.error : null;
  const ready = needsSetup
    ? name.trim() !== '' && email.trim() !== '' && password.length >= 12
    : email.trim() !== '' && password !== '';

  return (
    <div className="auth-screen">
      <aside className="auth-brand-panel">
        <div className="auth-brand"><span>M</span> MELTEK <small>DESIGN WORKSPACE</small></div>
        <div className="auth-brand-copy"><span className="eyebrow">ENGINEERED FOR EVERY TURN</span><h2>Precision starts<br />with a better view.</h2><p>One connected workspace for core sizing, winding construction and informed material decisions.</p></div>
        <CoreIllustration />
        <div className="auth-brand-footer"><span>LT CURRENT TRANSFORMERS</span><span>DESIGN / COMPARE / BUILD</span></div>
      </aside>
      <motion.div
        className="auth-form-panel"
        variants={fadeUp(Boolean(reduce))}
        initial="hidden"
        animate="show"
      >
        <div className="auth-form-wordmark">
          <Wordmark size={30} />
          <p className="mt-2 text-[13px] text-[var(--text-2)]">
            LT current transformer core design
          </p>
        </div>

        <form
          className="glossy rounded-[10px] p-6"
          onSubmit={(e) => { e.preventDefault(); if (ready && !submit.isPending) submit.mutate(); }}
        >
          <h1 className="text-[19px]">{needsSetup ? 'Set up your workspace' : 'Welcome back'}</h1>
          <p className="mt-1.5 text-[13px] text-[var(--text-2)]">
            {needsSetup
              ? 'Create the first administrator account. You can add the rest of the works afterwards.'
              : 'Your work is recorded against this account.'}
          </p>

          <div className="mt-5 flex flex-col gap-3">
            {needsSetup && (
              <TextField
                label="Your name" required value={name} autoComplete="name" autoFocus
                onChange={(e) => setName(e.target.value)}
              />
            )}
            <TextField
              label="Email" type="email" required value={email}
              autoComplete="username" autoFocus={!needsSetup}
              onChange={(e) => setEmail(e.target.value)}
            />
            <div className="auth-password">
            <TextField
              label="Password" type={showPassword ? 'text' : 'password'} required value={password}
              autoComplete={needsSetup ? 'new-password' : 'current-password'}
              onChange={(e) => setPassword(e.target.value)}
              {...(needsSetup
                ? { help: 'At least 12 characters. Length matters more than punctuation.' }
                : {})}
            />
            <button type="button" className="auth-password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? 'Hide' : 'Show'}</button>
            </div>
          </div>

          {error && (
            <div className="mt-4">
              <Callout tone="warn" title={needsSetup ? 'Setup could not complete' : 'Could not sign in'}>
                {error.message}
                {error.issues.length > 0 && (
                  <ul className="mt-1 list-disc pl-4">
                    {error.issues.map((i) => <li key={i.path}>{i.message}</li>)}
                  </ul>
                )}
              </Callout>
            </div>
          )}

          <div className="mt-5">
            <Button
              type="submit" variant="primary" className="w-full"
              disabled={!ready || submit.isPending}
            >
              {submit.isPending
                ? (needsSetup ? 'Creating…' : 'Signing in…')
                : (needsSetup ? 'Create administrator' : 'Sign in')}
            </Button>
          </div>

          {!needsSetup && (
            <p className="mt-4 text-center text-[12px] text-[var(--text-3)]">
              Forgotten your password? An administrator can set a new one for you.
            </p>
          )}
        </form>
      </motion.div>
    </div>
  );
}
