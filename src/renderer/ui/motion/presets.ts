import type { TargetAndTransition, Transition, Variants } from 'motion/react';

const easeStandard = [0.2, 0.82, 0.18, 1] as const;
const easeQuick = [0.22, 0.68, 0.18, 1] as const;

export const springSoft: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 36,
  mass: 0.88,
};

export const springFast: Transition = {
  type: 'spring',
  stiffness: 560,
  damping: 40,
  mass: 0.72,
};

export const pageTransition: Transition = {
  duration: 0.18,
  ease: easeStandard,
};

export const panelTransition: Transition = {
  duration: 0.16,
  ease: easeQuick,
};

export const miniPlayerTransition: Transition = {
  duration: 0.32,
  ease: easeStandard,
};

export const pageVariants: Variants = {
  enter: {
    opacity: 0,
  },
  active: {
    opacity: 1,
  },
  inactive: {
    opacity: 0,
  },
  exit: {
    opacity: 0,
  },
  reducedActive: {
    opacity: 1,
  },
  reducedInactive: {
    opacity: 0,
  },
};

export const panelVariants: Variants = {
  enter: {
    opacity: 0,
    x: 12,
  },
  active: {
    opacity: 1,
    x: 0,
  },
  inactive: {
    opacity: 0,
    x: 8,
  },
  exit: {
    opacity: 0,
    x: 10,
  },
  reducedActive: {
    opacity: 1,
    x: 0,
  },
  reducedInactive: {
    opacity: 0,
    x: 0,
  },
};

export const fadeVariants: Variants = {
  enter: {
    opacity: 0,
  },
  active: {
    opacity: 1,
  },
  inactive: {
    opacity: 0,
  },
  exit: {
    opacity: 0,
  },
};

export const hoverTapMotion: {
  whileHover: TargetAndTransition;
  whileTap: TargetAndTransition;
  transition: Transition;
} = {
  whileHover: {
    scale: 1.012,
  },
  whileTap: {
    scale: 0.985,
  },
  transition: {
    duration: 0.1,
    ease: easeQuick,
  },
};
