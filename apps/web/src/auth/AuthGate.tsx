import type { ReactNode } from 'react';
import { useSession } from './session';
import { SignIn } from './SignIn';
import { Skeleton } from '../shared/primitives';

/**
 * Nothing renders until we know who is asking.
 *
 * This is a convenience, not the security boundary — the API refuses anonymous requests
 * regardless. It keeps the interface from flashing controls the caller cannot use.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const session = useSession();

  if (session.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="w-full max-w-[420px]">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="mt-4 h-52 w-full" />
        </div>
      </div>
    );
  }

  if (!session.data?.user) {
    return <SignIn needsSetup={Boolean(session.data?.needsSetup)} />;
  }

  return <>{children}</>;
}
