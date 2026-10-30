import { useQuery, useQueryClient } from '@tanstack/react-query';
import { can, type Permission, type Role } from '@meltek/schema';
import { api } from '../shared/api';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  isProtected: boolean;
  createdAt: string;
  updatedAt: string;
  lastSignInAt: string | null;
}

export interface SessionState {
  needsSetup: boolean;
  user: SessionUser | null;
  permissions: Permission[];
}

/**
 * Who is signed in.
 *
 * The session is the single source of truth for what the interface offers. It is never
 * cached across a sign-out, and `staleTime` is zero so a role change or a disabled
 * account is picked up on the next navigation rather than lingering in a stale cache.
 */
export function useSession() {
  return useQuery<SessionState>({
    queryKey: ['session'],
    queryFn: api.session,
    staleTime: 0,
    retry: false,
  });
}

/**
 * Permission check for the interface.
 *
 * Reads the same matrix the API enforces with, so a control that is hidden here is also
 * refused there. This hides controls to keep the interface honest — it is not the
 * security boundary. The server is.
 */
export function usePermission(permission: Permission): boolean {
  const session = useSession();
  return can(session.data?.user?.role ?? null, permission);
}

export function useCurrentUser(): SessionUser | null {
  return useSession().data?.user ?? null;
}

/**
 * Sign out, then reload.
 *
 * Clearing the cache and reloading leaves nothing of the previous account in memory —
 * worth the extra navigation on a shared works machine.
 */
export function useSignOut() {
  const qc = useQueryClient();
  return async () => {
    await api.logout().catch(() => undefined);
    qc.clear();
    window.location.assign('/');
  };
}
