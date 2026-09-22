import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import {
  Avatar, Dropdown, DropdownDivider, DropdownHeader, DropdownItem,
  Sidebar, SidebarCollapse, SidebarItem, SidebarItemGroup, SidebarItems, Tooltip,
} from 'flowbite-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  HiBell, HiChevronDoubleLeft, HiCog, HiDocumentText, HiKey, HiLogout, HiMenu, HiMoon,
  HiOutlineCube, HiPencilAlt, HiRefresh, HiSun, HiViewGrid, HiX,
} from 'react-icons/hi';
import { ROLE_LABEL } from '@meltek/schema';
import { duration, ease } from '../lib/motion';
import { useCurrentUser, useSignOut } from '../lib/session';
import { useReference } from '../features/useCalculator';
import { useNotifications } from '../features/useNotifications';
import { ChangePasswordDialog } from './ChangePasswordDialog';

/** Initials for the avatar. "J. Saha" → "JS", "Design office" → "DO". */
function initialsOf(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} .-]/gu, '').split(/[\s.-]+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * flowbite renders its sidebar items as anchors and forwards `href`. This adapts that
 * to TanStack Router so navigation stays client-side.
 */
function RouterLink({ href, ...rest }: { href?: string } & Record<string, unknown>) {
  return <Link to={href ?? '/'} {...(rest as object)} />;
}

const EXPANDED = 248;
const COLLAPSED = 68;
/** Below this the rail collapses to icons on its own; below 900 it becomes a drawer (§9.4). */
const AUTO_COLLAPSE_AT = 1280;
const DRAWER_AT = 900;

export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span
      className="font-[family-name:var(--font-display)] font-extrabold italic leading-none select-none"
      style={{ color: 'var(--brand)', fontSize: size, letterSpacing: '-0.02em' }}
    >
      MELTEK
    </span>
  );
}

function useViewport() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return { width, isDrawer: width < DRAWER_AT, shouldAutoCollapse: width < AUTO_COLLAPSE_AT };
}

function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (document.documentElement.dataset.theme as 'dark' | 'light') ?? 'light',
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('meltek-theme', theme); } catch { /* private mode */ }
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}

export function Shell({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const currentUser = useCurrentUser();
  const canManageUsers = currentUser?.role === 'admin';
  const { isDrawer, shouldAutoCollapse } = useViewport();

  // Pinned open by the operator, auto-collapsed by width, temporarily expanded on hover.
  const [pinned, setPinned] = useState(() => {
    try { return localStorage.getItem('meltek-rail') !== 'collapsed'; } catch { return true; }
  });
  const [hovering, setHovering] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const autoCollapsed = shouldAutoCollapse || !pinned;
  const expanded = isDrawer ? drawerOpen : !autoCollapsed || hovering;
  const railWidth = isDrawer ? 0 : autoCollapsed ? COLLAPSED : EXPANDED;

  const togglePin = useCallback(() => {
    setPinned((p) => {
      try { localStorage.setItem('meltek-rail', p ? 'collapsed' : 'expanded'); } catch { /* ignore */ }
      return !p;
    });
  }, []);

  // Close the drawer on navigation, otherwise it covers the page you just opened.
  useEffect(() => { setDrawerOpen(false); }, [path]);

  return (
    <div className="min-h-dvh">
      <AnimatePresence>
        {isDrawer && drawerOpen && (
          <motion.div
            className="fixed inset-0 z-30 bg-black/50 no-print"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: duration.micro }}
            onClick={() => setDrawerOpen(false)}
          />
        )}
      </AnimatePresence>

      <motion.aside
        className="glossy-rail fixed inset-y-0 left-0 z-40 flex flex-col no-print"
        onMouseEnter={() => !isDrawer && autoCollapsed && setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        initial={false}
        animate={{
          width: isDrawer ? EXPANDED : expanded ? EXPANDED : COLLAPSED,
          x: isDrawer && !drawerOpen ? -EXPANDED : 0,
        }}
        transition={reduce ? { duration: 0 } : { duration: duration.base, ease: ease.out }}
      >
        <div className="flex h-[56px] shrink-0 items-center justify-between gap-2 px-4">
          <Link to="/" className="flex items-center gap-2 overflow-hidden">
            <HiOutlineCube className="h-5 w-5 shrink-0" style={{ color: 'var(--brand)' }} aria-hidden />
            {expanded && <Wordmark size={18} />}
          </Link>
          {expanded && (
            <button
              type="button"
              onClick={() => (isDrawer ? setDrawerOpen(false) : togglePin())}
              className="rounded-[6px] p-1 text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
              aria-label={isDrawer ? 'Close menu' : pinned ? 'Collapse the sidebar' : 'Keep the sidebar open'}
            >
              {isDrawer ? <HiX className="h-4 w-4" /> : <HiChevronDoubleLeft className="h-4 w-4" />}
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1">
          <Sidebar aria-label="Main" collapsed={!expanded} className="w-full [&>div]:bg-transparent">
            <SidebarItems>
              <SidebarItemGroup>
                <RailItem to="/" icon={HiPencilAlt} label="New design" active={path === '/'} expanded={expanded} />
                <RailItem to="/register" icon={HiViewGrid} label="Design register" active={path.startsWith('/register') || path.startsWith('/designs')} expanded={expanded} />
              </SidebarItemGroup>

              <SidebarItemGroup>
                {expanded ? (
                  <SidebarCollapse icon={HiCog} label="Reference data" open={path.startsWith('/admin')}>
                    <SidebarItem as={RouterLink} href="/admin" className="text-[13px]">Process settings</SidebarItem>
                    <SidebarItem as={RouterLink} href="/admin" className="text-[13px]">Steel grades &amp; curves</SidebarItem>
                    <SidebarItem as={RouterLink} href="/admin" className="text-[13px]">Wire gauges</SidebarItem>
                    <SidebarItem as={RouterLink} href="/admin" className="text-[13px]">Dies &amp; slit widths</SidebarItem>
                    <SidebarItem as={RouterLink} href="/admin" className="text-[13px]">Rates</SidebarItem>
                    {canManageUsers && (
                      <SidebarItem as={RouterLink} href="/admin" className="text-[13px]">Accounts</SidebarItem>
                    )}
                  </SidebarCollapse>
                ) : (
                  <RailItem to="/admin" icon={HiCog} label="Reference data" active={path.startsWith('/admin')} expanded={false} />
                )}
              </SidebarItemGroup>
            </SidebarItems>
          </Sidebar>
        </div>

        <div className="shrink-0 border-t border-[var(--line)] px-4 py-3">
          {expanded ? (
            <div className="text-[11px] leading-relaxed text-[var(--text-3)]">
              <p className="flex items-center gap-1.5">
                <HiDocumentText className="h-3.5 w-3.5" aria-hidden /> LT CT core design
              </p>
              <p className="mt-0.5">Meltek · v1.0.0</p>
            </div>
          ) : (
            <Tooltip content="LT CT core design · v1.0.0" placement="right">
              <HiDocumentText className="h-4 w-4 text-[var(--text-3)]" aria-hidden />
            </Tooltip>
          )}
        </div>
      </motion.aside>

      <motion.div
        initial={false}
        animate={{ paddingLeft: railWidth }}
        transition={reduce ? { duration: 0 } : { duration: duration.base, ease: ease.out }}
      >
        <Header onOpenDrawer={() => setDrawerOpen(true)} isDrawer={isDrawer} />

        <main className="mx-auto max-w-[1440px] px-4 py-6 md:px-8 md:py-10">
          <motion.div
            key={path}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
            transition={{ duration: reduce ? duration.instant : duration.page, ease: ease.out }}
          >
            {children}
          </motion.div>
        </main>
      </motion.div>
    </div>
  );
}

function RailItem({
  to, icon: Icon, label, active, expanded,
}: {
  to: string; icon: typeof HiCog; label: string; active: boolean; expanded: boolean;
}) {
  const item = (
    <SidebarItem as={RouterLink} href={to} icon={Icon} active={active} className="group">
      {label}
    </SidebarItem>
  );
  return expanded ? item : <Tooltip content={label} placement="right">{item}</Tooltip>;
}

/* ─────────────────────────── header ─────────────────────────── */

function Header({ onOpenDrawer, isDrawer }: { onOpenDrawer: () => void; isDrawer: boolean }) {
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const fetching = useIsFetching();
  const reference = useReference();
  const notifications = useNotifications(reference.data);
  const user = useCurrentUser();
  const signOut = useSignOut();
  const [changingPassword, setChangingPassword] = useState(false);
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  const refresh = () => { void qc.invalidateQueries(); };

  return (
    <header className="glossy-bar sticky top-0 z-20 flex h-[56px] items-center justify-between gap-3 px-4 md:px-6 no-print">
      <div className="flex items-center gap-3">
        {isDrawer && (
          <button
            type="button" onClick={onOpenDrawer} aria-label="Open the menu"
            className="rounded-[8px] p-2 text-[var(--text-2)] hover:bg-[var(--surface-2)]"
          >
            <HiMenu className="h-5 w-5" />
          </button>
        )}
        <span className="hidden text-[13px] text-[var(--text-2)] sm:block">
          Low tension current transformer core design
        </span>
      </div>

      <div className="flex items-center gap-1">
        <Tooltip content={fetching ? 'Refreshing…' : 'Refresh reference data and designs'}>
          <button
            type="button" onClick={refresh} aria-label="Refresh"
            className="rounded-[8px] p-2 text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
          >
            <motion.span
              className="block"
              animate={fetching && !reduce ? { rotate: 360 } : { rotate: 0 }}
              transition={fetching && !reduce
                ? { repeat: Infinity, duration: 0.9, ease: 'linear' }
                : { duration: duration.micro }}
            >
              <HiRefresh className="h-5 w-5" />
            </motion.span>
          </button>
        </Tooltip>

        <Tooltip content={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}>
          <button
            type="button" onClick={toggle}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            className="rounded-[8px] p-2 text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
          >
            {theme === 'dark' ? <HiSun className="h-5 w-5" /> : <HiMoon className="h-5 w-5" />}
          </button>
        </Tooltip>

        <Dropdown
          arrowIcon={false}
          dismissOnClick={false}
          label=""
          renderTrigger={() => (
            <button
              type="button"
              aria-label={`Notifications, ${notifications.length} open items`}
              className="relative rounded-[8px] p-2 text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            >
              <HiBell className="h-5 w-5" />
              {notifications.length > 0 && (
                <span
                  className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold num text-white"
                  style={{ background: 'var(--brand)' }}
                >
                  {notifications.length}
                </span>
              )}
            </button>
          )}
        >
          <DropdownHeader>
            <span className="block text-[13px] font-semibold text-[var(--text)]">Setup</span>
            <span className="block text-[12px] text-[var(--text-2)]">
              Reference data still to be entered for this works.
            </span>
          </DropdownHeader>
          <div className="max-h-[360px] w-[340px] overflow-y-auto">
            {notifications.length === 0 && (
              <p className="px-4 py-6 text-center text-[13px] text-[var(--text-2)]">
                Everything is set up.
              </p>
            )}
            {notifications.map((n) => (
              <DropdownItem
                key={n.id}
                onClick={() => void navigate({ to: n.to })}
                className="items-start"
              >
                <span
                  aria-hidden className="mt-[5px] h-2 w-2 shrink-0 rounded-full"
                  style={{ background: `var(--${n.tone === 'provisional' ? 'provisional' : n.tone})` }}
                />
                <span className="text-left">
                  <span className="flex items-center gap-2 font-medium text-[var(--text)]">
                    {n.title}
                    <span className="mono text-[10px] text-[var(--text-3)]">{n.ref}</span>
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-[var(--text-2)]">{n.detail}</span>
                </span>
              </DropdownItem>
            ))}
          </div>
        </Dropdown>

        <Dropdown
          arrowIcon={false}
          label=""
          renderTrigger={() => (
            <button
              type="button"
              className="ml-1 flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-2)] py-1 pl-1 pr-3 transition-colors hover:border-[var(--line-strong)]"
              aria-label="Account"
            >
              <Avatar placeholderInitials={initialsOf(user?.name ?? '?')} rounded size="xs" />
              <span className="hidden text-[13px] text-[var(--text-2)] md:block">
                {user?.name ?? 'Account'}
              </span>
            </button>
          )}
        >
          <DropdownHeader>
            <span className="block text-[13px] font-semibold text-[var(--text)]">
              {user?.name ?? 'Not signed in'}
            </span>
            <span className="block text-[12px] text-[var(--text-2)]">{user?.email}</span>
            {user && (
              <span className="mt-1 inline-block rounded-full border border-[var(--line-strong)] px-2 py-[1px] text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-2)]">
                {ROLE_LABEL[user.role]}
              </span>
            )}
          </DropdownHeader>
          <DropdownItem icon={HiKey} onClick={() => setChangingPassword(true)}>
            Change password
          </DropdownItem>
          <DropdownItem icon={HiCog} onClick={() => void navigate({ to: '/admin' })}>
            Reference data
          </DropdownItem>
          <DropdownDivider />
          <DropdownItem icon={HiLogout} onClick={() => void signOut()}>
            Sign out
          </DropdownItem>
        </Dropdown>
      </div>

      <ChangePasswordDialog open={changingPassword} onClose={() => setChangingPassword(false)} />
    </header>
  );
}
