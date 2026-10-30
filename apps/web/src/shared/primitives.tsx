import { Button as FbButton, Tooltip } from 'flowbite-react';
import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { duration } from './motion';

/* ─────────────────────────── buttons ─────────────────────────── */

type ButtonProps = {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  className?: string;
};

/**
 * flowbite Button in MELTEK dress. The press scale lives in the theme so it is a CSS
 * transition, not a JS animation: motion must never gate interaction, and the click
 * fires on mousedown rather than after the animation (§10.3).
 */
export function Button({
  children, variant = 'secondary', size = 'md', type = 'button',
  disabled, onClick, title, className = '',
}: ButtonProps) {
  const button = (
    <FbButton
      type={type}
      color={variant}
      size={size}
      disabled={disabled}
      onClick={onClick}
      className={className}
    >
      {children}
    </FbButton>
  );
  return title ? <Tooltip content={title}>{button}</Tooltip> : button;
}

/* ─────────────────────────── surfaces ─────────────────────────── */

export function Card({
  children, className = '', title, subtitle, actions, eyebrow,
}: {
  children: ReactNode; className?: string;
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
          <div>
            {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
            {title && <h2 className="text-[15px]">{title}</h2>}
            {subtitle && <p className="mt-1 text-[13px] text-[var(--text-2)] measure">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** A page heading: eyebrow, title, one line of orientation, then a fading rule. */
export function PageHeader({
  eyebrow, title, children, actions,
}: { eyebrow: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h1 className="mt-1.5 text-[28px]">{title}</h1>
          {children && <p className="measure mt-2 text-[14px] text-[var(--text-2)]">{children}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className="rule-fade" />
    </header>
  );
}

/* ─────────────────────────── badges ─────────────────────────── */

const toneColor: Record<string, string> = {
  neutral: 'var(--text-2)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  info: 'var(--info)',
  provisional: 'var(--provisional)',
  brand: 'var(--brand)',
};

export function Badge({
  children, tone = 'neutral', title,
}: { children: ReactNode; tone?: keyof typeof toneColor; title?: string }) {
  const color = toneColor[tone] ?? toneColor.neutral;
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[10px] font-semibold uppercase tracking-[0.06em] leading-[1.5]"
      style={{ color, borderColor: color, background: 'color-mix(in srgb, currentColor 8%, transparent)' }}
    >
      {children}
    </span>
  );
}

/**
 * Weights and costs are marked wherever they appear. They are sound arithmetic on the
 * current rate table, but a rate table moves and a works order is the final word, so
 * the figure is presented as an estimate rather than a quoted price.
 */
export function ProvisionalMark({ label = 'estimate' }: { label?: string }) {
  return (
    <Tooltip content="Estimated from the current rate table and the rounded slit width. Check against the works order before quoting.">
      <Badge tone="provisional">{label}</Badge>
    </Tooltip>
  );
}

/**
 * A setting still holding the shipped default. Marked so an engineer can see which
 * numbers have been set for this works and which have not.
 */
export function UnconfirmedMark({ note }: { note?: string }) {
  return (
    <Tooltip content={note ?? 'Still using the shipped default. Review this value for your process.'}>
      <Badge tone="warn">default</Badge>
    </Tooltip>
  );
}

/* ─────────────────────────── numbers ─────────────────────────── */

/**
 * An animated counter, only when the value actually changed (§10.2).
 */
export function AnimatedNumber({
  value, dp = 2, prefix = '', suffix = '',
}: { value: number | null; dp?: number; prefix?: string; suffix?: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value ?? 0);
  const previous = useRef(value ?? 0);
  const frame = useRef(0);

  useEffect(() => {
    if (value === null) return;
    const from = previous.current;
    const to = value;
    previous.current = to;
    if (reduce || from === to) { setShown(to); return; }

    const start = performance.now();
    const ms = duration.base * 1000;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      // expo-out, matching ease.out
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (to - from) * eased);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [value, reduce]);

  if (value === null) return <span className="num text-[var(--text-3)]">—</span>;
  return <span className="num">{prefix}{shown.toFixed(dp)}{suffix}</span>;
}

/**
 * A headline number. The accent spine on the left is the only colour a tile carries —
 * it marks which quantity is provisional without tinting the number itself.
 */
export function StatTile({
  label, children, note, tone,
}: { label: string; children: ReactNode; note?: ReactNode; tone?: 'brand' | 'provisional' }) {
  const accent = tone === 'brand' ? 'var(--brand)' : tone === 'provisional' ? 'var(--provisional)' : 'var(--line-strong)';
  return (
    <div
      className="relative overflow-hidden rounded-[6px] border border-[var(--line)] px-4 py-3.5"
      style={{
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--text) 3%, transparent) 0%, transparent 46%), var(--surface-2)',
        boxShadow: 'inset 0 1px 0 color-mix(in srgb, var(--text) 5%, transparent)',
      }}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[2px]" style={{ background: accent }} />
      <div className="label">{label}</div>
      <div
        className="mt-1.5 font-[family-name:var(--font-display)] text-[23px] font-bold num leading-none tracking-[-0.02em]"
        style={tone === 'provisional' ? { color: 'var(--provisional)' } : tone === 'brand' ? { color: 'var(--brand)' } : undefined}
      >
        {children}
      </div>
      {note && <div className="mt-2 text-[11px] leading-snug text-[var(--text-3)]">{note}</div>}
    </div>
  );
}

/* ─────────────────────────── feedback ─────────────────────────── */

/**
 * §9.2 — red is reserved for identity and primary action. Errors use --warn with an
 * icon, never the brand red, which would collide with it.
 */
export function Callout({
  tone = 'warn', title, children,
}: { tone?: 'warn' | 'info' | 'ok' | 'provisional'; title?: ReactNode; children?: ReactNode }) {
  const color = toneColor[tone];
  return (
    <div
      className="flex gap-3 rounded-[5px] border-l-2 border-y border-r px-4 py-3 text-[13px]"
      style={{
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
        borderLeftColor: color,
        background: `color-mix(in srgb, ${color} 6%, transparent)`,
      }}
    >
      <span
        aria-hidden
        className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
        style={{ color, border: `1px solid ${color}` }}
      >
        {tone === 'ok' ? '✓' : tone === 'info' ? 'i' : '!'}
      </span>
      <div>
        {title && <div className="font-semibold" style={{ color }}>{title}</div>}
        {children && <div className="text-[var(--text-2)]">{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-5 py-14 text-center">
      <p className="font-[family-name:var(--font-display)] text-[16px]">{title}</p>
      {children && <p className="mx-auto mt-2 max-w-[46ch] text-[13px] text-[var(--text-2)]">{children}</p>}
    </div>
  );
}

export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div
      className={`rounded-[3px] ${className}`}
      style={{
        background: reduce
          ? 'var(--surface-2)'
          : 'linear-gradient(90deg, var(--surface-2) 0%, var(--surface-3) 50%, var(--surface-2) 100%)',
        backgroundSize: '200% 100%',
        animation: reduce ? undefined : 'meltek-shimmer 1.4s linear infinite',
      }}
    />
  );
}
