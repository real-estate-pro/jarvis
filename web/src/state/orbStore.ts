import { create } from "zustand";

export interface ToolTag {
  id: string;
  name: string;
  label?: string;
  /** "ending" tags are fading out. */
  phase: "active" | "ending";
}

/** Where the orb sits on screen, in CSS pixels (set by the camera rig). */
export interface OrbLayout {
  x: number;
  y: number;
  radius: number;
}

interface OrbState {
  /** 0..1 render quality; lowered automatically when frames run long. */
  quality: number;
  setQuality: (quality: number) => void;
  layout: OrbLayout;
  setLayout: (layout: OrbLayout) => void;
  toolTags: ToolTag[];
  setToolTags: (update: (tags: ToolTag[]) => ToolTag[]) => void;
}

export const useOrbStore = create<OrbState>((set) => ({
  quality: 1,
  setQuality: (quality) => set({ quality }),
  layout: { x: 0, y: 0, radius: 0 },
  setLayout: (layout) => set({ layout }),
  toolTags: [],
  setToolTags: (update) => set((s) => ({ toolTags: update(s.toolTags) })),
}));
