import React from 'react';

const GnomeDecoration = () => (
  <svg width="108" height="108" viewBox="0 0 108 108" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* ── Outer ring ── */}
    <circle cx="54" cy="54" r="50" stroke="#1a2d4a" strokeWidth="1"/>

    {/* Outer accent arcs — three evenly spaced */}
    <path d="M54 4 A50 50 0 0 1 97.3 29" stroke="#4d7cc5" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
    <path d="M97.3 79 A50 50 0 0 1 54 104" stroke="#4d7cc5" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
    <path d="M10.7 79 A50 50 0 0 1 10.7 29" stroke="#4d7cc5" strokeWidth="1.8" strokeLinecap="round" fill="none"/>

    {/* Six dots on outer ring (hexagonal positions) */}
    <circle cx="54"   cy="4"    r="3"   fill="#4d7cc5"/>
    <circle cx="97.3" cy="29"   r="3"   fill="#4d7cc5"/>
    <circle cx="97.3" cy="79"   r="3"   fill="#4d7cc5"/>
    <circle cx="54"   cy="104"  r="3"   fill="#4d7cc5"/>
    <circle cx="10.7" cy="79"   r="2.2" fill="#2a4a7a"/>
    <circle cx="10.7" cy="29"   r="2.2" fill="#2a4a7a"/>

    {/* ── Middle hexagon ── */}
    <polygon
      points="54,20 81.8,35 81.8,69 54,84 26.2,69 26.2,35"
      stroke="#1e3564" strokeWidth="1" fill="none"
    />

    {/* Midpoint dots on hexagon edges */}
    <circle cx="67.9" cy="27.5" r="1.6" fill="#2a5090"/>
    <circle cx="81.8" cy="52"   r="1.6" fill="#2a5090"/>
    <circle cx="67.9" cy="76.5" r="1.6" fill="#2a5090"/>
    <circle cx="40.1" cy="76.5" r="1.6" fill="#2a5090"/>
    <circle cx="26.2" cy="52"   r="1.6" fill="#2a5090"/>
    <circle cx="40.1" cy="27.5" r="1.6" fill="#2a5090"/>

    {/* ── Inner ring ── */}
    <circle cx="54" cy="54" r="24" stroke="#2a4a82" strokeWidth="1.2" fill="none"/>

    {/* Inner accent arc */}
    <path d="M54 30 A24 24 0 1 1 53.9 30" stroke="#3560a0" strokeWidth="1" strokeLinecap="round" fill="none" strokeDasharray="18 130"/>

    {/* Diagonal spoke lines from inner ring to hexagon vertices */}
    <line x1="54"  y1="30"  x2="54"  y2="20"  stroke="#1e3564" strokeWidth="0.8" opacity="0.7"/>
    <line x1="78"  y1="54"  x2="81.8" y2="52" stroke="#1e3564" strokeWidth="0.8" opacity="0.7"/>
    <line x1="78"  y1="54"  x2="81.8" y2="69" stroke="#1e3564" strokeWidth="0.8" opacity="0.5"/>
    <line x1="54"  y1="78"  x2="54"  y2="84"  stroke="#1e3564" strokeWidth="0.8" opacity="0.7"/>
    <line x1="30"  y1="54"  x2="26.2" cy="52" stroke="#1e3564" strokeWidth="0.8" opacity="0.5"/>

    {/* ── Center cluster ── */}
    {/* Center glow */}
    <circle cx="54" cy="54" r="11" fill="#0f1f3a" opacity="0.9"/>
    <circle cx="54" cy="54" r="8"  fill="#162a50"/>
    <circle cx="54" cy="54" r="5"  fill="#2a4e8a"/>
    <circle cx="54" cy="54" r="2.5" fill="#5b9ee0"/>
    <circle cx="54" cy="54" r="1.2" fill="#a8d4ff"/>

    {/* Four small corner crosshair ticks */}
    <line x1="54" y1="43" x2="54" y2="40" stroke="#4d7cc5" strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
    <line x1="65" y1="54" x2="68" y2="54" stroke="#4d7cc5" strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
    <line x1="54" y1="65" x2="54" y2="68" stroke="#4d7cc5" strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
    <line x1="43" y1="54" x2="40" y2="54" stroke="#4d7cc5" strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
  </svg>
);

export default function KaliLoader({ text = 'INITIALIZING...', fullScreen = false }) {
  const inner = (
    <div className="flex flex-col items-center justify-between h-full py-10 select-none">
      <div className="flex-1 flex flex-col items-center justify-center gap-8">
        <GnomeDecoration />

        <div className="text-center">
          <div className="text-[#c8d8ec] text-base font-semibold tracking-[0.55em] uppercase mb-3"
            style={{ fontFamily: 'system-ui, ui-sans-serif, sans-serif', letterSpacing: '0.55em' }}>
            MediaTunnel
          </div>
          <div className="flex items-center gap-2 justify-center">
            <span className="inline-block w-1 h-1 rounded-full bg-[#4d7cc5] animate-pulse" style={{ animationDelay: '0ms' }}/>
            <span className="inline-block w-1 h-1 rounded-full bg-[#4d7cc5] animate-pulse" style={{ animationDelay: '200ms' }}/>
            <span className="inline-block w-1 h-1 rounded-full bg-[#4d7cc5] animate-pulse" style={{ animationDelay: '400ms' }}/>
            <span className="text-[#4d7cc5] text-[10px] tracking-[0.28em] uppercase ml-1"
              style={{ fontFamily: 'ui-monospace, monospace' }}>
              {text}
            </span>
          </div>
        </div>
      </div>

      {/* Progress bar — thin, full-width */}
      <div className="w-full px-10">
        <div className="h-[1.5px] w-full overflow-hidden rounded-full" style={{ background: '#0f1f35' }}>
          <div
            className="h-full rounded-full loading-bar"
            style={{ background: 'linear-gradient(90deg, #162a50 0%, #4d7cc5 50%, #7eb3ff 100%)' }}
          />
        </div>
      </div>
    </div>
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 flex flex-col" style={{ background: '#0d1117' }}>
        {inner}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col rounded mx-auto my-4"
      style={{ background: '#0d1117', minHeight: '300px', maxWidth: '380px' }}
    >
      {inner}
    </div>
  );
}
