import { useId } from 'react';

/** Decorative concept illustration. The calculator provides the dimensioned model. */
export function CoreIllustration() {
  const id = useId().replace(/:/g, '');
  return <svg viewBox="0 0 480 350" aria-hidden="true" className="core-illustration">
    <defs>
      <linearGradient id={`${id}-steel`} x1="0" y1="0" x2=".9" y2="1"><stop stopColor="#c9bdb9" /><stop offset=".24" stopColor="#7a6b66" /><stop offset=".55" stopColor="#d8ccc7" /><stop offset=".76" stopColor="#786661" /><stop offset="1" stopColor="#3c2c29" /></linearGradient>
      <linearGradient id={`${id}-copper`}><stop stopColor="#7d2520" /><stop offset=".4" stopColor="#ed9180" /><stop offset=".65" stopColor="#c5503e" /><stop offset="1" stopColor="#70211c" /></linearGradient>
      <filter id={`${id}-shadow`} x="-50%" y="-50%" width="200%" height="220%"><feGaussianBlur stdDeviation="15" /></filter>
    </defs>
    <g stroke="currentColor" strokeOpacity=".09" fill="none">{Array.from({ length: 11 }, (_, i) => <path key={i} d={`M${i * 48} 0v350 M0 ${i * 35}h480`} />)}</g>
    <ellipse cx="244" cy="277" rx="135" ry="23" fill="#1f1515" opacity=".17" filter={`url(#${id}-shadow)`} />
    <g transform="translate(240 158) rotate(-24) scale(1 .72)">
      <circle cy="34" r="105" fill="none" stroke="#493530" strokeWidth="64" />
      <path d="M-137 0v34 M137 0v34 M-73 0v34 M73 0v34" stroke="#493530" strokeWidth="2" />
      <circle r="105" fill="none" stroke={`url(#${id}-steel)`} strokeWidth="64" />
      {[76, 81, 86, 91, 96, 101, 106, 111, 116, 121, 126, 131].map(r => <circle key={r} r={r} fill="none" stroke="#f1ded5" strokeWidth=".7" opacity=".4" />)}
      <circle r="137" fill="none" stroke="#f4ded5" strokeWidth="1.2" opacity=".8" />
      {Array.from({ length: 13 }, (_, i) => <g key={i} transform={`rotate(${i * 4.4 + 2})`}><path d="M75 0 L134 0 Q142 2 142 13 L142 30 Q139 43 131 43 L77 43 Q69 40 69 30 L69 12 Q69 2 75 0" fill="none" stroke={`url(#${id}-copper)`} strokeWidth="7" /></g>)}
    </g>
    <g fill="none" stroke="#b4231b" strokeWidth="1" opacity=".5"><path d="M86 95H40v120h43 M365 208h65v-97h-28" /><circle cx="86" cy="95" r="3" /><circle cx="365" cy="208" r="3" /><path d="M137 298h206 M137 294v8 M343 294v8" strokeDasharray="3 3" /></g>
    <g fill="currentColor" opacity=".6" fontFamily="Inter, sans-serif" fontSize="9" letterSpacing="1.8"><text x="33" y="239">STEEL + COPPER</text><text x="319" y="90">RING CONSTRUCTION</text><text x="177" y="322">CONCEPT ILLUSTRATION</text></g>
  </svg>;
}
