"use client";

import { fitRange, KeyboardLayout } from "@/lib/render/keyboard";

export interface KeyMark {
  color: string;
  label?: string;
}

/** A small SVG keyboard with marked keys (chord shapes, finger numbers). */
export function MiniKeyboard({
  marks,
  lo,
  hi,
  height = 92,
  onKey,
}: {
  marks: Map<number, KeyMark>;
  lo?: number;
  hi?: number;
  height?: number;
  onKey?: (pitch: number) => void;
}) {
  const ps = [...marks.keys()];
  const [a, b] = fitRange(lo ?? Math.min(...ps) - 3, hi ?? Math.max(...ps) + 3, 10);
  const width = 600;
  const layout = new KeyboardLayout(a, b, width);
  const bh = height * 0.62;
  const white = layout.keys.filter((k) => !k.black);
  const black = layout.keys.filter((k) => k.black);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full select-none" role="img">
      {white.map((k) => {
        const m = marks.get(k.pitch);
        return (
          <g key={k.pitch} onClick={() => onKey?.(k.pitch)} className={onKey ? "cursor-pointer" : undefined}>
            <rect x={k.x + 0.75} y={0} width={k.w - 1.5} height={height} rx={4} fill={m ? m.color : "#fbfbf9"} stroke="#d4d3ce" strokeWidth={1} />
            {m?.label && (
              <text x={k.x + k.w / 2} y={height - 12} textAnchor="middle" fontSize={Math.min(18, k.w * 0.5)} fontWeight={700} fill="#fff">
                {m.label}
              </text>
            )}
            {!m && k.pitch % 12 === 0 && (
              <text x={k.x + k.w / 2} y={height - 10} textAnchor="middle" fontSize={Math.min(12, k.w * 0.36)} fill="#a2a29c">
                C{Math.floor(k.pitch / 12) - 1}
              </text>
            )}
          </g>
        );
      })}
      {black.map((k) => {
        const m = marks.get(k.pitch);
        return (
          <g key={k.pitch} onClick={() => onKey?.(k.pitch)} className={onKey ? "cursor-pointer" : undefined}>
            <rect x={k.x} y={0} width={k.w} height={bh} rx={3} fill={m ? m.color : "#23262c"} stroke={m ? "#00000033" : "none"} />
            {m?.label && (
              <text x={k.x + k.w / 2} y={bh - 9} textAnchor="middle" fontSize={Math.min(16, k.w * 0.62)} fontWeight={700} fill="#fff">
                {m.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
