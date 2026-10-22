import type { SVGProps } from 'react';

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 26,
  height: 26,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

export const HomeIcon = ({ filled, ...p }: SVGProps<SVGSVGElement> & { filled?: boolean }) => (
  <svg {...base(p)} fill={filled ? 'currentColor' : 'none'}>
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
  </svg>
);
export const StarIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
  </svg>
);
export const WalletIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1M4 7v10a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H6a2 2 0 0 1-2-1z" />
    <circle cx="16" cy="13.5" r="1.2" />
  </svg>
);
export const PlaneIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M21 3 10 14M21 3l-7 18-4-7-7-4z" />
  </svg>
);
export const PlusIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 34, height: 34, strokeWidth: 2.4, ...p })}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const CommentIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 22, height: 22, ...p })}>
    <path d="M21 12a8 8 0 0 1-11.8 7L3 21l2-5.6A8 8 0 1 1 21 12z" />
    <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" strokeWidth={2.4} />
  </svg>
);
/** Presentear: seta para cima dentro de um quadrado arredondado (como no desenho). */
export const GiftIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 22, height: 22, ...p })}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
    <path d="M12 16V8M8.5 11.5 12 8l3.5 3.5" />
  </svg>
);
