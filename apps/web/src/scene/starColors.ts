import * as THREE from 'three';

const STELLAR_SWATCHES = [
  { limit: 0.06, hex: '#4d86ff' }, // hot blue
  { limit: 0.2, hex: '#9fc2ff' }, // blue-white
  { limit: 0.56, hex: '#eef5ff' }, // white
  { limit: 0.8, hex: '#ffd88a' }, // warm yellow-white
  { limit: 0.93, hex: '#ffb067' }, // orange
  { limit: 1.0, hex: '#ff7c67' }, // red-orange
] as const;

function seededUnit(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return x - Math.floor(x);
}

export function stellarColorHex(seed: number): string {
  const unit = seededUnit(seed);
  for (const swatch of STELLAR_SWATCHES) {
    if (unit <= swatch.limit) return swatch.hex;
  }
  return '#f7fbff';
}

export function stellarColor(seed: number, mixHex?: string, mixAmount = 0): THREE.Color {
  const color = new THREE.Color(stellarColorHex(seed));
  const whiteLift = seededUnit(seed * 1.37 + 4.2) * 0.04;
  color.lerp(new THREE.Color('#ffffff'), whiteLift);

  if (mixHex && mixAmount > 0) {
    color.lerp(new THREE.Color(mixHex), mixAmount);
  }

  return color;
}
