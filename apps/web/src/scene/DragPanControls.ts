import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

const MIN_ZOOM = 36;
const MAX_ZOOM = 220;
const ZOOM_SENSITIVITY = 0.0015;

function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

function worldPointAtPointer(
  camera: THREE.OrthographicCamera,
  size: { width: number; height: number },
  clientX: number,
  clientY: number,
  rect: DOMRect,
): { x: number; y: number } {
  const nx = (clientX - rect.left) / rect.width;
  const ny = (clientY - rect.top) / rect.height;
  const viewWidth = (camera.right - camera.left) / camera.zoom;
  const viewHeight = (camera.top - camera.bottom) / camera.zoom;
  return {
    x: camera.position.x + (nx - 0.5) * viewWidth,
    y: camera.position.y + (0.5 - ny) * viewHeight,
  };
}

/**
 * Drag-to-pan + wheel-to-zoom controls for an OrthographicCamera.
 *
 * Attaches pointer listeners to the gl.domElement. Movement on the camera is
 * computed in world units (taking the orthographic zoom into account) so a
 * one-pixel drag moves the camera by one-pixel-worth of world distance.
 *
 * If the pointerdown landed on a sprite (the MovieNode), R3F's event bubbling
 * stops it from reaching the canvas-level handler, so we never start a drag.
 */
export function useDragPanControls(opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled ?? true;
  const { camera, gl, size } = useThree();
  const dragging = useRef<{ sx: number; sy: number; cx: number; cy: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const dom = gl.domElement;
    const ortho = camera as THREE.OrthographicCamera;
    const onDown = (e: PointerEvent) => {
      // Only primary button
      if (e.button !== 0) return;
      // If a sprite handled this already, it called stopPropagation on the
      // R3F-side; the native DOM event still fires. We use a small flag set by
      // the canvas-wrapper (see ConstellationCanvas) to know whether to start.
      if ((window as any).__nodePointerActive) return;
      dragging.current = {
        sx: e.clientX,
        sy: e.clientY,
        cx: camera.position.x,
        cy: camera.position.y,
        moved: false,
      };
      dom.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - dragging.current.sx;
      const dy = e.clientY - dragging.current.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragging.current.moved = true;
      // World units per pixel: (right - left) / viewportWidth, then divided by zoom
      const worldPerPxX = (ortho.right - ortho.left) / size.width / ortho.zoom;
      const worldPerPxY = (ortho.top - ortho.bottom) / size.height / ortho.zoom;
      camera.position.x = dragging.current.cx - dx * worldPerPxX;
      camera.position.y = dragging.current.cy + dy * worldPerPxY;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = dom.getBoundingClientRect();
      const before = worldPointAtPointer(ortho, size, e.clientX, e.clientY, rect);
      const nextZoom = clampZoom(ortho.zoom * Math.exp(-e.deltaY * ZOOM_SENSITIVITY));
      if (nextZoom === ortho.zoom) return;
      ortho.zoom = nextZoom;
      ortho.updateProjectionMatrix();
      const after = worldPointAtPointer(ortho, size, e.clientX, e.clientY, rect);
      camera.position.x += before.x - after.x;
      camera.position.y += before.y - after.y;
    };
    const onUp = (e: PointerEvent) => {
      dom.releasePointerCapture?.(e.pointerId);
      dragging.current = null;
    };
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('wheel', onWheel, { passive: false });
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('pointercancel', onUp);
    return () => {
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointercancel', onUp);
    };
  }, [camera, gl, size, enabled]);
}
