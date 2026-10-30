import { createTheme } from 'flowbite-react';

/**
 * flowbite-react, dressed in the MELTEK design system (§9).
 *
 * The components ship with Tailwind's blue/gray palette. Everything here rewrites that
 * onto our CSS custom properties, so a theme switch moves the whole interface at once
 * and the one chromatic accent stays the brand red.
 */

/*
 * flowbite composes a field's classes as base → colors → sizes → withAddon, and
 * tailwind-merge keeps the LAST of any conflicting utilities. Anything visual therefore
 * has to live in `colors`/`sizes`/`withAddon`, not in `base`, or the shipped grey-and-blue
 * defaults win. Learned the hard way: a radius set in `base` was silently replaced by
 * flowbite's own `rounded-lg`.
 */

/** Structure only. Everything that could collide is set further down. */
const FIELD_BASE =
  'block w-full border transition-[border-color,box-shadow,background-color] duration-100 ' +
  'focus:outline-none disabled:cursor-not-allowed disabled:opacity-40';

/*
 * Colour, border and focus. These are applied after `base`, so this is what shows —
 * with one catch: flowbite's defaults carry `dark:` variants (dark:bg-gray-700 and
 * friends), and tailwind-merge does not treat `dark:bg-*` as conflicting with a plain
 * `bg-*`. Both survive, and the dark variant wins whenever it matches. Every override
 * therefore has to be mirrored with a `dark:` twin pointing at the same token.
 */
const darkTwin = (classes: string): string =>
  classes
    .split(/\s+/)
    .filter(Boolean)
    .map((c) => `dark:${c}`)
    .join(' ');

/**
 * Our tokens already switch with the theme, so a rule and its dark twin are identical.
 * Emitting both is what makes ours win over flowbite's `dark:bg-gray-700` defaults.
 */
const themed = (classes: string): string => `${classes} ${darkTwin(classes)}`;

const FIELD_COLOR_LIGHT =
  'border-[var(--line)] bg-[var(--surface-2)] text-[var(--text)] ' +
  'placeholder-[var(--text-3)] placeholder:text-[var(--text-3)] ' +
  'shadow-[inset_0_1px_2px_rgba(0,0,0,0.12)] ' +
  'hover:border-[var(--line-strong)] ' +
  'focus:border-[var(--brand)] focus:ring-0 ' +
  'focus:shadow-[0_0_0_3px_var(--brand-glow),inset_0_1px_2px_rgba(0,0,0,0.12)]';

const FIELD_COLOR = `${FIELD_COLOR_LIGHT} ${darkTwin(FIELD_COLOR_LIGHT)}`;

const FIELD_INVALID_LIGHT =
  'border-[var(--warn)] bg-[var(--surface-2)] text-[var(--text)] ' +
  'focus:border-[var(--warn)] focus:ring-0 ' +
  'focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--warn)_28%,transparent)]';

const FIELD_INVALID = `${FIELD_INVALID_LIGHT} ${darkTwin(FIELD_INVALID_LIGHT)}`;

const FIELD_SIZES = {
  sm: 'px-2.5 py-1.5 text-[13px]',
  md: 'px-3 py-2 text-[14px]',
  lg: 'px-3.5 py-2.5 text-[15px]',
};

/**
 * 5px. Heavy rounding reads as consumer software; an instrument has crisp corners.
 * Set here because `withAddon` is the last thing flowbite appends.
 */
const FIELD_RADIUS = { off: 'rounded-[5px]', on: 'rounded-r-[5px] rounded-l-none' };

export const meltekTheme = createTheme({
  button: {
    base:
      'group relative flex items-center justify-center rounded-[5px] font-medium ' +
      'transition-[filter,box-shadow,background-color,transform] duration-100 ' +
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] ' +
      'active:scale-[0.975] disabled:pointer-events-none disabled:opacity-40',
    color: {
      // Primary: the brand red, reserved for identity and the primary action.
      primary: themed(
        'bg-[var(--brand)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] ' +
        'hover:brightness-110 hover:shadow-[0_0_0_4px_var(--brand-glow),inset_0_1px_0_rgba(255,255,255,0.18)]',
      ),
      secondary: themed(
        'border border-[var(--line)] bg-[var(--surface-1)] text-[var(--text)] ' +
        'shadow-[inset_0_1px_0_color-mix(in_srgb,var(--text)_6%,transparent)] ' +
        'hover:bg-[var(--surface-2)] hover:border-[var(--line-strong)]',
      ),
      ghost: themed('text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'),
      // Errors use warn, never the brand red, which would collide with it (§9.2).
      warning: themed('bg-[var(--warn)] text-[var(--bg)] hover:brightness-110'),
    },
    size: {
      xs: 'h-7 px-2.5 text-[12px]',
      sm: 'h-8 px-3 text-[13px]',
      md: 'h-10 px-4 text-[14px]',
      lg: 'h-11 px-5 text-[15px]',
    },
  },

  textInput: {
    field: {
      input: {
        base: FIELD_BASE,
        colors: { gray: FIELD_COLOR, failure: FIELD_INVALID },
        sizes: FIELD_SIZES,
        withAddon: FIELD_RADIUS,
        withIcon: { off: '', on: 'pl-10' },
        withRightIcon: { off: '', on: 'pr-10' },
      },
      icon: { base: 'pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[var(--text-3)]' },
      rightIcon: { base: 'pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-[var(--text-3)]' },
    },
  },

  select: {
    field: {
      select: {
        base: `${FIELD_BASE} appearance-none bg-arrow-down-icon bg-[length:0.7em_0.7em] bg-[position:right_10px_center] bg-no-repeat pr-9`,
        colors: { gray: FIELD_COLOR, failure: FIELD_INVALID },
        sizes: FIELD_SIZES,
        withAddon: FIELD_RADIUS,
        withIcon: { off: '', on: 'pl-10' },
      },
    },
  },

  label: {
    root: {
      base: themed('text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-3)]'),
      colors: { default: '', failure: themed('text-[var(--warn)]') },
    },
  },

  checkbox: {
    base: themed(
      'h-4 w-4 rounded-[3px] border border-[var(--line-strong)] bg-[var(--surface-2)] ' +
      'text-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-glow)]',
    ),
  },

  dropdown: {
    floating: {
      base: 'z-40 w-fit rounded-[8px] divide-y divide-[var(--line)] focus:outline-none',
      style: {
        auto: themed(
          'glossy border border-[var(--line)] bg-[var(--surface-1)] text-[var(--text)] ' +
          'shadow-[var(--shadow-lg)]',
        ),
      },
      content: 'py-1 text-[13px]',
      divider: themed('my-1 h-px bg-[var(--line)]'),
      header: themed('block px-4 py-2 text-[12px] text-[var(--text-2)]'),
      item: {
        base: themed(
          'flex w-full cursor-pointer items-center justify-start gap-2 px-4 py-2 text-[13px] ' +
          'text-[var(--text)] transition-colors hover:bg-[var(--surface-2)] focus:bg-[var(--surface-2)] focus:outline-none',
        ),
        icon: 'mr-1 h-4 w-4 text-[var(--text-3)]',
      },
      target: 'w-fit',
    },
    arrowIcon: 'ml-2 h-4 w-4',
  },

  tooltip: {
    target: 'w-fit',
    base: themed(
      'absolute z-50 inline-block rounded-[5px] border border-[var(--line-strong)] ' +
      'bg-[var(--surface-3)] px-2.5 py-1.5 text-[12px] font-normal leading-snug text-[var(--text)] ' +
      'shadow-[var(--shadow-md)] max-w-[280px]',
    ),
    arrow: { base: themed('absolute z-10 h-2 w-2 rotate-45 bg-[var(--surface-3)]') },
  },

  progress: {
    base: themed('w-full overflow-hidden rounded-full bg-[var(--surface-3)]'),
    bar: 'rounded-full text-center font-medium leading-none text-white transition-[width] duration-500',
    color: {
      primary: themed('bg-[var(--brand)]'),
      ok: themed('bg-[var(--ok)]'),
      warn: themed('bg-[var(--warn)]'),
      info: themed('bg-[var(--info)]'),
      provisional: themed('bg-[var(--provisional)]'),
    },
    size: { sm: 'h-1.5', md: 'h-2.5', lg: 'h-4' },
  },

  avatar: {
    root: {
      base: 'flex items-center justify-center space-x-4 rounded',
      initials: {
        base: themed('relative inline-flex items-center justify-center overflow-hidden bg-[var(--surface-3)]'),
        text: themed('font-semibold text-[var(--text-2)] text-[12px]'),
      },
      color: { brand: 'ring-2 ring-[var(--brand)]' },
    },
  },

  badge: {
    root: {
      base: 'flex h-fit items-center gap-1 font-semibold',
      color: {
        brand: 'bg-[var(--brand-wash)] text-[var(--brand)]',
        gray: 'bg-[var(--surface-3)] text-[var(--text-2)]',
      },
      size: { xs: 'px-2 py-0.5 text-[10px]', sm: 'px-2.5 py-0.5 text-[12px]' },
    },
  },

  sidebar: {
    root: {
      base: 'h-full',
      inner: themed('h-full overflow-y-auto overflow-x-hidden bg-transparent px-2 py-3'),
    },
    item: {
      base: themed(
        'relative flex items-center justify-center rounded-[6px] p-2 text-[14px] font-normal ' +
        'text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
      ),
      active: themed('rail-active text-[var(--text)]'),
      icon: {
        base: themed('h-5 w-5 shrink-0 text-[var(--text-3)] transition-colors group-hover:text-[var(--text-2)]'),
        active: themed('text-[var(--brand)]'),
      },
      content: { base: 'flex-1 whitespace-nowrap px-2' },
    },
    collapse: {
      button: themed(
        'group flex w-full items-center rounded-[6px] p-2 text-[14px] font-normal text-[var(--text-2)] ' +
        'transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
      ),
      icon: {
        base: 'h-5 w-5 shrink-0 text-[var(--text-3)]',
        open: { off: '', on: 'text-[var(--brand)]' },
      },
      label: { base: 'ml-2 flex-1 whitespace-nowrap text-left', title: 'sr-only' },
      list: 'space-y-1 py-1 pl-3',
    },
    itemGroup: {
      base: 'mt-3 space-y-1 border-t border-[var(--line)] pt-3 first:mt-0 first:border-t-0 first:pt-0',
    },
  },
});

/** Progress bar colour for a cost ratio: cheap is good, far above the leader is not. */
export function costTone(ratio: number): 'ok' | 'primary' | 'warn' {
  if (ratio <= 1.05) return 'ok';
  if (ratio <= 1.4) return 'primary';
  return 'warn';
}
