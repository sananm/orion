export const MIN_ZOOM = 36;
export const MAX_ZOOM = 220;
export const DEFAULT_ZOOM = 68;
export const ZOOM_SENSITIVITY = 0.0015;
export const SHOW_ALL_LABELS_ZOOM = 82;

export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}
