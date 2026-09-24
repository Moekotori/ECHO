import { forwardRef, type ReactNode } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';

const getStrokeWidth = (
  strokeWidth: LucideProps['strokeWidth'],
  size: LucideProps['size'],
  absoluteStrokeWidth?: boolean,
): number | string | undefined => {
  if (!absoluteStrokeWidth || typeof size !== 'number') {
    return strokeWidth;
  }

  return (Number(strokeWidth) * 24) / size;
};

const createQueueControlIcon = (displayName: string, paths: ReactNode): LucideIcon => {
  const Icon = forwardRef<SVGSVGElement, LucideProps>(
    ({ absoluteStrokeWidth, children, color = 'currentColor', size = 24, strokeWidth = 1.65, ...props }, ref) => (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={getStrokeWidth(strokeWidth, size, absoluteStrokeWidth)}
        {...props}
      >
        {paths}
        {children}
      </svg>
    ),
  );

  Icon.displayName = displayName;
  return Icon as LucideIcon;
};

export const EchoSequenceIcon = createQueueControlIcon(
  'EchoSequenceIcon',
  <>
    <circle cx="4.8" cy="6.8" r=".8" fill="currentColor" stroke="none" />
    <circle cx="4.8" cy="12" r=".8" fill="currentColor" stroke="none" />
    <circle cx="4.8" cy="17.2" r=".8" fill="currentColor" stroke="none" />
    <path d="M7.5 6.8h11.7" />
    <path d="M7.5 12h9.2" />
    <path d="M7.5 17.2h6.8" />
  </>,
);

export const EchoShuffleIcon = createQueueControlIcon(
  'EchoShuffleIcon',
  <>
    <path d="M4.5 7h2.2c1.3 0 2.1.5 2.9 1.6l5 6.8c.8 1.1 1.6 1.6 2.9 1.6h2" />
    <path d="m17.4 14.8 2.2 2.2-2.2 2.2" />
    <path d="M4.5 17h2.2c1.3 0 2.1-.5 2.9-1.6l5-6.8c.8-1.1 1.6-1.6 2.9-1.6h2" />
    <path d="m17.4 4.8 2.2 2.2-2.2 2.2" />
  </>,
);

export const EchoContinueIcon = createQueueControlIcon(
  'EchoContinueIcon',
  <>
    <path d="M4.5 6.6h5.2" />
    <path d="M4.5 11.1h3.8" />
    <path d="M4.5 15.6h5.2" />
    <path d="M12.2 6.6h1c3.6 0 6.3 2.1 6.3 5.4s-2.7 5.4-6.3 5.4h-1.7" />
    <path d="m13.6 15.2-2.2 2.2 2.2 2.2" />
  </>,
);

export const EchoSmartTransitionIcon = createQueueControlIcon(
  'EchoSmartTransitionIcon',
  <>
    <path d="M4.5 8.2h2.2c2 0 3.1 1 4.3 3.8s2.3 3.8 4.3 3.8h4.2" />
    <path d="M4.5 15.8h2.2c2 0 3.1-1 4.3-3.8s2.3-3.8 4.3-3.8h4.2" />
  </>,
);

export const EchoGaplessIcon = createQueueControlIcon(
  'EchoGaplessIcon',
  <>
    <path d="M4.5 7.2v9.6" />
    <path d="M12 6v12" />
    <path d="M19.5 7.2v9.6" />
    <path d="M4.5 12h2.1l1.2-3 1.8 6 1.4-3h2l1.2-3 1.8 6 1.3-3h2.2" />
  </>,
);
