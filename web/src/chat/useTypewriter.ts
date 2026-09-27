import { useEffect, useRef, useState } from "react";

/**
 * Reveals streamed text at a smooth, catch-up rate instead of in network-sized chunks.
 * Once `active` goes false, the full text shows immediately.
 */
export function useTypewriter(text: string, active: boolean): string {
  const [shown, setShown] = useState(active ? 0 : text.length);
  const target = useRef(text.length);
  target.current = text.length;

  useEffect(() => {
    if (!active) {
      setShown(text.length);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setShown((n) => {
        const remaining = target.current - n;
        if (remaining <= 0) return n;
        // ~60 chars/s baseline, faster when far behind.
        return Math.min(target.current, n + Math.max(1, Math.ceil((60 + remaining * 4) * dt)));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, text.length]);

  return text.slice(0, shown);
}
