"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Height that stretches the element from its top edge to the viewport
 * bottom (minus `reserve` px), tracking window resizes. Returns `fallback`
 * while disabled or before the element is measured.
 */
export function useFillHeight(
  ref: RefObject<HTMLElement | null>,
  { enabled, fallback, reserve, min = fallback }: {
    enabled: boolean;
    fallback: number;
    /** Space kept below the element for trailing content. */
    reserve: number;
    min?: number;
  },
): number {
  const [measured, setMeasured] = useState<number | undefined>();

  useEffect(() => {
    if (!enabled) return () => {};
    const measure = () => {
      const top = ref.current?.getBoundingClientRect().top;
      if (top === undefined) return;
      setMeasured(Math.max(min, Math.floor(window.innerHeight - top - reserve)));
    };
    // Defer one frame so the dialog has applied its fullscreen layout.
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [enabled, min, ref, reserve]);

  return enabled ? (measured ?? fallback) : fallback;
}
