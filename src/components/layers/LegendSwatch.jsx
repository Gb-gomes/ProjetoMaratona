/** Amostra de legenda: símbolo do ponto, traço da linha ou área do polígono. */
export default function LegendSwatch({
  geometryType, color, fill = null, symbol = 'circle', weight = 2, fillOpacity = 0.25, dash = null, size = 16,
}) {
  const s = size;
  const c = s / 2;
  let shape;
  if (geometryType === 'point') {
    const r = s * 0.3;
    if (symbol === 'square') shape = <rect x={c - r} y={c - r} width={r * 2} height={r * 2} fill={color} stroke="#fff" strokeWidth="1" />;
    else if (symbol === 'triangle') shape = <polygon points={`${c},${c - r * 1.15} ${c + r * 1.05},${c + r * 0.8} ${c - r * 1.05},${c + r * 0.8}`} fill={color} stroke="#fff" strokeWidth="1" />;
    else if (symbol === 'diamond') shape = <polygon points={`${c},${c - r * 1.25} ${c + r * 1.25},${c} ${c},${c + r * 1.25} ${c - r * 1.25},${c}`} fill={color} stroke="#fff" strokeWidth="1" />;
    else shape = <circle cx={c} cy={c} r={r} fill={color} stroke="#fff" strokeWidth="1" />;
  } else if (geometryType === 'line') {
    shape = <path d={`M2 ${s - 4} C ${s * 0.35} ${s * 0.2}, ${s * 0.65} ${s * 0.9}, ${s - 2} 4`} fill="none" stroke={color} strokeWidth={Math.min(4, Math.max(1.5, weight))} strokeDasharray={dash ?? undefined} strokeLinecap="round" />;
  } else {
    shape = <rect x="2" y="3" width={s - 4} height={s - 6} rx="1.5" fill={fill ?? color} fillOpacity={Math.max(0.15, fillOpacity)} stroke={color} strokeWidth={Math.min(2.5, Math.max(1, weight))} strokeDasharray={dash ?? undefined} />;
  }
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} className="shrink-0" aria-hidden="true">
      {shape}
    </svg>
  );
}
