"use client";

import { useEffect, useMemo, useRef } from "react";

export type ConstellationCover = { url: string; label: string };

type Placed = {
  cover: ConstellationCover;
  x: number; y: number; size: number; rotate: number;
  // Each cover drifts on its own slow loop. Independent periods and phases
  // stop the field ever pulsing in unison, which is what makes a scatter read
  // as alive rather than as one animated block.
  driftX: number; driftY: number; period: number; phase: number;
  depth: number;
};

function seeded(index: number, salt: number) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export default function CoverConstellation({ covers }: { covers: ConstellationCover[] }) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: -999, y: -999, active: false });
  const frame = useRef<number>(0);

  // Placement is deterministic, so it belongs in the render rather than in an
  // effect that sets state -- same result, one render instead of two, and the
  // entry animation is pure CSS with a per-cover delay.
  const placed = useMemo<Placed[]>(() => {
    const items: Placed[] = covers.map((cover, index) => {
      const x = 3 + seeded(index, 1) * 90;
      const y = seeded(index, 2) * 86;
      // Smaller covers sit further back and drift less, which is the whole
      // depth cue -- there are no shadows doing that work.
      const depth = seeded(index, 6);
      return {
        cover,
        x, y,
        size: 58 + depth * 84,
        rotate: (seeded(index, 4) - 0.5) * 9,
        driftX: (seeded(index, 8) - 0.5) * 26 * (0.4 + depth),
        driftY: (seeded(index, 9) - 0.5) * 30 * (0.4 + depth),
        period: 9000 + seeded(index, 10) * 11000,
        phase: seeded(index, 11) * Math.PI * 2,
        depth,
      };
    });
    // Nothing in the middle band, so the headline is framed rather than
    // covered.
    return items.filter((item) => item.x < 28 || item.x > 64 || item.y < 20 || item.y > 72);
  }, [covers]);

  useEffect(() => {
    if (!placed.length) return;
    const field = fieldRef.current;
    if (!field) return;
    // Honoured properly: with reduced motion the covers are placed and then
    // left completely still, rather than merely slowed down.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const nodes = Array.from(field.querySelectorAll<HTMLElement>("[data-cover]"));
    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const rect = field!.getBoundingClientRect();
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        const item = placed[index];
        if (!item) continue;
        const t = (elapsed / item.period) * Math.PI * 2 + item.phase;
        let offsetX = Math.sin(t) * item.driftX;
        let offsetY = Math.cos(t * 0.78) * item.driftY;

        // Touch or cursor pushes covers aside, then they drift back. On a
        // phone this is the whole interaction, so it reads through touch
        // rather than hover.
        if (pointer.current.active) {
          const centreX = rect.width * (item.x / 100) + offsetX;
          const centreY = rect.height * (item.y / 100) + offsetY;
          const deltaX = centreX - pointer.current.x;
          const deltaY = centreY - pointer.current.y;
          const distance = Math.hypot(deltaX, deltaY);
          const reach = 190;
          if (distance < reach && distance > 0.01) {
            const push = (1 - distance / reach) ** 2 * 78 * (0.5 + item.depth);
            offsetX += (deltaX / distance) * push;
            offsetY += (deltaY / distance) * push;
          }
        }

        node.style.transform = `translate3d(${offsetX.toFixed(2)}px, ${offsetY.toFixed(2)}px, 0) rotate(${(item.rotate + Math.sin(t * 0.6) * 1.6).toFixed(2)}deg)`;
      }
      frame.current = requestAnimationFrame(tick);
    }
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [placed]);

  function movePointer(clientX: number, clientY: number) {
    const rect = fieldRef.current?.getBoundingClientRect();
    if (!rect) return;
    pointer.current = { x: clientX - rect.left, y: clientY - rect.top, active: true };
  }

  return (
    <div
      className="constellation"
      onPointerLeave={() => { pointer.current.active = false; }}
      onPointerMove={(event) => movePointer(event.clientX, event.clientY)}
      onTouchEnd={() => { pointer.current.active = false; }}
      onTouchMove={(event) => { const touch = event.touches[0]; if (touch) movePointer(touch.clientX, touch.clientY); }}
    >
      <div className="constellation-field" ref={fieldRef} aria-hidden="true">
        {placed.map((item, index) => (
          <span
            className="constellation-slot"
            key={`${item.cover.url}-${index}`}
            style={{
              left: `${item.x}%`,
              top: `${item.y}%`,
              width: `${item.size}px`,
              // Staggered so the field assembles rather than appearing.
              animationDelay: `${(index * 45).toFixed(0)}ms`,
              // Recessed covers stay recessed once settled, which is the depth
              // cue standing in for the shadows this design does not use.
              ["--settled-opacity" as string]: item.depth < 0.35 ? "0.5" : "1",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- publisher CDNs, not configured next/image hosts */}
            <img alt="" className="constellation-cover" data-cover loading="lazy" src={item.cover.url} />
          </span>
        ))}
      </div>
      <div className="constellation-copy">
        <p className="constellation-kicker">RAR Index</p>
        <h2>What is your manga actually worth?</h2>
        <p>Verified sales, exact editions, and the printing you actually own.</p>
        <div className="constellation-actions">
          <span className="prototype-button">Search the catalogue</span>
          <span className="prototype-button is-quiet">Track your collection</span>
        </div>
        <p className="constellation-hint">Drag across the covers</p>
      </div>
    </div>
  );
}
