import type { FlowchartShape } from '../FlowchartNode';

export function FlowchartShapeIcon({ shape }: { shape: FlowchartShape }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinejoin: 'round' as const };

  return (
    <svg aria-hidden="true" className="size-4 shrink-0" viewBox="0 0 24 24">
      {shape === 'diamond' && <path {...common} d="m12 3 8 9-8 9-8-9z" />}
      {shape === 'parallelogram' && <path {...common} d="m7 4h14l-4 16H3z" />}
      {shape === 'oval' && <rect {...common} x="3" y="6" width="18" height="12" rx="6" />}
      {shape === 'circle' && <circle {...common} cx="12" cy="12" r="8" />}
      {shape === 'database' && <><path {...common} d="M4 6v12c0 3 16 3 16 0V6" /><ellipse {...common} cx="12" cy="6" rx="8" ry="3" /><path {...common} d="M4 12c0 3 16 3 16 0" /></>}
      {shape === 'document' && <path {...common} d="M5 3h9l5 5v13H5zM14 3v5h5" />}
      {shape === 'cloud' && <path {...common} d="M6 18h11a4 4 0 0 0 .7-7.9A5.5 5.5 0 0 0 7 8.5 4.5 4.5 0 0 0 6 18Z" />}
      {shape === 'rectangle' && <rect {...common} x="3" y="5" width="18" height="14" rx="2" />}
    </svg>
  );
}
