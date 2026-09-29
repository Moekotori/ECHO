import { useReducedMotion } from 'motion/react';

export const useReducedMotionSafe = (): boolean => {
  return useReducedMotion() === true;
};
