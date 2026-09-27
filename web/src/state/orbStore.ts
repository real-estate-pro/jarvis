import { create } from "zustand";

interface OrbState {
  /** 0..1 render quality; lowered automatically when frames run long. */
  quality: number;
  setQuality: (quality: number) => void;
}

export const useOrbStore = create<OrbState>((set) => ({
  quality: 1,
  setQuality: (quality) => set({ quality }),
}));
