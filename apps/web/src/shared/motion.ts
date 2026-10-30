import type { Transition, Variants } from 'motion/react';

/**
 * Motion tokens (§10.1).
 *
 * Fast, purposeful, almost subliminal. A 600 ms page fade feels cheap; a 220 ms one
 * feels expensive. Only transform and opacity are animated.
 */
export const duration = {
  instant: 0.09,
  micro: 0.15,
  base: 0.22,
  page: 0.32,
  hero: 0.5,
} as const;

export const ease = {
  out: [0.22, 1, 0.36, 1] as [number, number, number, number],
  inOut: [0.4, 0, 0.2, 1] as [number, number, number, number],
  spring: { type: 'spring', stiffness: 380, damping: 32, mass: 0.8 } as Transition,
};

/** Every variant collapses to opacity-only when the user asks for reduced motion. */
export const fadeUp = (reduce: boolean, distance = 12): Variants => ({
  hidden: reduce ? { opacity: 0 } : { opacity: 0, y: distance },
  show: reduce
    ? { opacity: 1, transition: { duration: duration.instant } }
    : { opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.out } },
  exit: reduce
    ? { opacity: 0, transition: { duration: duration.instant } }
    : { opacity: 0, transition: { duration: duration.micro, ease: ease.inOut } },
});

export const pageVariants = (reduce: boolean): Variants => ({
  hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 12 },
  show: reduce
    ? { opacity: 1, transition: { duration: duration.instant } }
    : { opacity: 1, y: 0, transition: { duration: duration.page, ease: ease.out } },
  exit: { opacity: 0, transition: { duration: duration.micro } },
});

/** Step reveal (§10.2) — theatre, and worth it: it makes a 3 ms calculation feel considered. */
export const stagger = (reduce: boolean, amount = 0.04): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: reduce ? 0 : amount } },
});
