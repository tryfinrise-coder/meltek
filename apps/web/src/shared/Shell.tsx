import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import {
  Avatar, Dropdown, DropdownDivider, DropdownHeader, DropdownItem, Tooltip,
} from 'flowbite-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  HiBell, HiChevronDoubleLeft, HiCog, HiKey, HiLogout, HiMenu, HiMoon,
  HiRefresh, HiSun, HiX,
} from 'react-icons/hi';
import { CalculatorStatusContext, type CalculatorStatus } from './CalculatorStatus';
import { ROLE_LABEL } from '@meltek/schema';

import { duration, ease } from './motion';
import { useCurrentUser, useSignOut } from '../auth/session';
import { useReference } from '../design/useCalculator';
import { useNotifications } from './useNotifications';
import { ChangePasswordDialog } from '../auth/ChangePasswordDialog';

/** Initials for the avatar. "J. Saha" → "JS", "Design office" → "DO". */
function initialsOf(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} .-]/gu, '').split(/[\s.-]+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const EXPANDED = 248;
const COLLAPSED = 64;
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
  return { isDrawer: width < DRAWER_AT };
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
  const { isDrawer } = useViewport();
  const location = useRouterState({ select: s => s.location });
  const isCalculatorRoute = path === '/calculator' || path === '/design/new';
  const [calculatorStatus, setCalculatorStatus] = useState<CalculatorStatus | null>(null);

  // Collapsed by default; pointer hover or keyboard focus reveals labels. Pinning is optional.
  const [pinned, setPinned] = useState(() => {
    try { return localStorage.getItem('meltek-rail-mode') === 'pinned'; } catch { return false; }
  });
  const [hovering, setHovering] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isDrawer || !drawerOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]') ?? []);
    focusable()[0]?.focus({ preventScroll: true });
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setDrawerOpen(false); }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const target = event.shiftKey ? items.at(-1) : items[0];
      if (document.activeElement === (event.shiftKey ? items[0] : items.at(-1))) {
        event.preventDefault();
        target?.focus();
      }
    };
    document.addEventListener('keydown', trapFocus);
    return () => {
      document.removeEventListener('keydown', trapFocus);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [isDrawer, drawerOpen]);

  const autoCollapsed = !pinned;
  const expanded = isDrawer ? drawerOpen : !autoCollapsed || hovering || keyboardFocus;
  const railWidth = isDrawer ? 0 : autoCollapsed ? COLLAPSED : EXPANDED;

  const togglePin = useCallback(() => {
    setPinned((p) => {
      try { localStorage.setItem('meltek-rail-mode', p ? 'auto' : 'pinned'); } catch { /* ignore */ }
      return !p;
    });
  }, []);

  // Close the drawer on navigation, otherwise it covers the page you just opened.
  useEffect(() => { setDrawerOpen(false); }, [location.href, isDrawer]);

  return (
    <CalculatorStatusContext.Provider value={setCalculatorStatus}>
    <div className="app-shell reference-shell min-h-dvh" style={{ '--calculator-rail-width': `${railWidth}px` } as CSSProperties}>
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
        ref={sidebarRef}
        role={isDrawer && drawerOpen ? 'dialog' : undefined}
        aria-modal={isDrawer && drawerOpen ? true : undefined}
        className="glossy-rail fixed inset-y-0 left-0 z-40 flex flex-col no-print"
        aria-label="Application sidebar"
        data-expanded={expanded}
        inert={isDrawer && !drawerOpen}
        onFocusCapture={e => { if (!isDrawer && e.target.matches(':focus-visible')) setKeyboardFocus(true); }}
        onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget)) setKeyboardFocus(false); }}
        onKeyDown={e => { if (e.key === 'Escape') { setDrawerOpen(false); setHovering(false); setKeyboardFocus(false); } }}
        onMouseEnter={() => !isDrawer && autoCollapsed && setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        initial={false}
        animate={{
          width: isDrawer ? EXPANDED : expanded ? EXPANDED : COLLAPSED,
          x: isDrawer && !drawerOpen ? -EXPANDED : 0,
        }}
        transition={reduce ? { duration: 0 } : { duration: duration.base, ease: ease.out }}
      >
        <div className="flex h-[56px] shrink-0 items-center justify-between gap-2 px-3">
          <Link to="/" className="flex items-center gap-2.5 overflow-hidden">
            <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[7px] text-[15px] font-semibold" style={{ background: 'var(--brand)', color: '#fff', fontFamily: "'Inter', sans-serif" }}>M</span>
            {expanded && (
              <span className="flex flex-col leading-tight">
                <span className="text-[13px] font-semibold tracking-wide" style={{ color: 'var(--sidebar-text)' }}>MELTEK</span>
                <span className="text-[10px]" style={{ color: 'var(--sidebar-text-2)' }}>CT design calculator</span>
              </span>
            )}
          </Link>
          {expanded && (
            <button
              type="button"
              onClick={() => (isDrawer ? setDrawerOpen(false) : togglePin())}
              className="rounded-[6px] p-1 transition-colors hover:bg-white/10"
              style={{ color: 'var(--sidebar-text-2)' }}
              aria-label={isDrawer ? 'Close menu' : pinned ? 'Use hover to expand sidebar' : 'Keep the sidebar open'}
            >
              {isDrawer ? <HiX className="h-4 w-4" /> : <HiChevronDoubleLeft className="h-4 w-4" />}
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2">
          {expanded && <div className="mb-1 px-2 pt-3 text-[10px] font-medium uppercase tracking-[0.12em]" style={{ color: 'var(--sidebar-text-2)' }}>Menu</div>}
          <nav className="flex flex-col gap-0.5" aria-label="Main navigation">
            {([
              { to: '/', label: 'Dashboard', abbr: 'DB', match: (p: string) => p === '/' },
              { to: '/design/new', label: 'New design', abbr: 'ND', match: (p: string) => p === '/design/new' },
              { to: '/register', label: 'Designs', abbr: 'DS', match: (p: string) => p.startsWith('/register') || p.startsWith('/designs') },
              { to: '/admin', label: 'Reference data', abbr: 'RD', match: (p: string) => p.startsWith('/admin') },
            ] as const).map(item => {
              const active = item.match(path);
              const inner = (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-label={item.label}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors"
                  style={{
                    background: active ? 'var(--sidebar-active)' : undefined,
                    color: active ? '#fff' : 'var(--sidebar-text)',
                  }}
                  aria-current={active ? 'page' : undefined}
                >
                  {expanded ? (
                    <span>{item.label}</span>
                  ) : (
                    <span className="mx-auto text-[12px] font-medium" style={{ fontFamily: "'Inter', sans-serif" }}>{item.abbr}</span>
                  )}
                </Link>
              );
              return expanded ? inner : <Tooltip key={item.to} content={item.label} placement="right">{inner}</Tooltip>;
            })}
          </nav>

          {isCalculatorRoute && (
            <>
              {expanded && <div className="mb-1 mt-5 px-2 text-[10px] font-medium uppercase tracking-[0.12em]" style={{ color: 'var(--sidebar-text-2)' }}>On this page</div>}
              {!expanded && <div className="my-3 mx-2" style={{ borderTop: '1px solid var(--sidebar-line)' }} />}
              <nav className="flex flex-col gap-0.5" aria-label="Page sections">
                {[
                  ['calculator-inputs', '01', 'Inputs'],
                  ['calculator-calculation', '02', 'Calculation'],
                  ['calculator-results', '03', 'Results'],
                  ['calculator-model', '04', '3D model'],
                ].map(([id, num, label]) => {
                  const btn = (
                    <button
                      key={num}
                      type="button"
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/8"
                      style={{ color: 'var(--sidebar-text-2)' }}
                      onClick={() => document.getElementById(id!)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    >
                      <span className="grid h-[24px] w-[24px] shrink-0 place-items-center rounded-full text-[11px] font-medium" style={{ background: 'var(--brand)', color: '#fff', fontFamily: "'Inter', sans-serif" }}>{num}</span>
                      {expanded && <span className="text-[13px]">{label}</span>}
                    </button>
                  );
                  return expanded ? btn : <Tooltip key={num} content={label} placement="right">{btn}</Tooltip>;
                })}
              </nav>
            </>
          )}
        </div>

        <div className="shrink-0 px-3 py-3" style={{ borderTop: '1px solid var(--sidebar-line)' }}>
          {expanded ? (
            <div className="flex items-center gap-2.5">
              <span className="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-full text-[11px] font-medium" style={{ background: 'var(--sidebar-active)', color: 'var(--sidebar-text)' }}>
                {initialsOf(currentUser?.name ?? '?')}
              </span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-[12px] font-medium" style={{ color: 'var(--sidebar-text)' }}>{currentUser?.name ?? 'Engineer'}</span>
                <span className="truncate text-[10px]" style={{ color: 'var(--sidebar-text-2)' }}>{currentUser ? ROLE_LABEL[currentUser.role] : 'Design team'}</span>
              </span>
            </div>
          ) : (
            <Tooltip content={`${currentUser?.name ?? 'Engineer'} · ${currentUser ? ROLE_LABEL[currentUser.role] : ''}`} placement="right">
              <span className="mx-auto grid h-[28px] w-[28px] place-items-center rounded-full text-[11px] font-medium" style={{ background: 'var(--sidebar-active)', color: 'var(--sidebar-text)' }}>
                {initialsOf(currentUser?.name ?? '?')}
              </span>
            </Tooltip>
          )}
          <div className="mt-2 text-center">
            <span className="inline-grid h-[22px] w-[22px] place-items-center rounded-[5px] text-[10px] font-semibold" style={{ background: 'var(--sidebar-active)', color: 'var(--sidebar-text-2)', fontFamily: "'Inter', sans-serif" }}>EN</span>
          </div>
        </div>
      </motion.aside>

      <motion.div
        inert={isDrawer && drawerOpen}
        initial={false}
        animate={{ paddingLeft: railWidth }}
        transition={reduce ? { duration: 0 } : { duration: duration.base, ease: ease.out }}
      >
        <Header onOpenDrawer={() => setDrawerOpen(true)} isDrawer={isDrawer} calculatorStatus={calculatorStatus} />

        <a href="#workspace-content" className="skip-navigation">Skip to content</a>
        <main id="workspace-content" tabIndex={-1} className={`mx-auto max-w-[1440px] px-4 py-6 md:px-8 md:py-10 ${isCalculatorRoute ? 'reference-main' : ''}`}>
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
    </CalculatorStatusContext.Provider>
  );
}

/* ─────────────────────────── header ─────────────────────────── */

function BreadcrumbForPath({ path }: { path: string }) {
  const crumbs: { label: string; to?: string }[] = [];
  if (path === '/') crumbs.push({ label: 'Dashboard' });
  else if (path === '/design/new') { crumbs.push({ label: 'Designs', to: '/register' }); crumbs.push({ label: 'New design' }); }
  else if (path === '/calculator') crumbs.push({ label: 'Calculator' });
  else if (path.startsWith('/designs/')) { crumbs.push({ label: 'Designs', to: '/register' }); crumbs.push({ label: 'Design detail' }); }
  else if (path === '/register') crumbs.push({ label: 'Designs' });
  else if (path === '/admin') crumbs.push({ label: 'Reference data' });
  return (
    <nav className="flex items-center gap-1.5 text-[13px]" aria-label="Breadcrumb">
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-[var(--text-3)]">/</span>}
          {c.to ? <Link to={c.to} className="text-[var(--text-3)] hover:text-[var(--text)]">{c.label}</Link> : <span className="font-medium text-[var(--text)]">{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}

function Header({ onOpenDrawer, isDrawer, calculatorStatus }: { onOpenDrawer: () => void; isDrawer: boolean; calculatorStatus: CalculatorStatus | null }) {
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
  const path = useRouterState({ select: (s) => s.location.pathname });
  const isDesignRoute = path === '/calculator' || path === '/design/new';

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
        <BreadcrumbForPath path={path} />
        {!isDesignRoute && <span className="workspace-mobile-title">{path === '/' ? 'Dashboard' : path === '/register' ? 'Design register' : path.startsWith('/admin') ? 'Reference data' : 'Design details'}</span>}
        {isDesignRoute && (
          <div className="workspace-ct-tabs hidden h-full sm:flex">
            <button type="button" className="font-semibold">LT CT</button>
            <span className="text-[13px] text-[var(--text-2)]">Low-tension current transformer</span>
            <span className="ct-tab-more">+ More soon</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        {isDesignRoute && (
          <span className="mr-2 hidden items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5 text-[11px] text-[var(--text-2)] lg:flex">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: calculatorStatus?.ready ? '#2F7D4F' : 'var(--brand)' }} />
            {calculatorStatus?.text ?? 'Loading calculation'}
            <span className="text-[var(--text-3)]">{calculatorStatus?.mode ?? 'LT CT'}</span>
          </span>
        )}
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
                onClick={() => void navigate({ to: '/admin', search: { tab: n.tab } })}
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
