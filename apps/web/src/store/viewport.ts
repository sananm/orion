import { create } from 'zustand';

import { clampZoom, DEFAULT_ZOOM } from '@/scene/cameraConfig';

type ViewportState = {
  zoom: number;
  setZoom: (zoom: number) => void;
};

export const useViewport = create<ViewportState>((set) => ({
  zoom: DEFAULT_ZOOM,
  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
}));
