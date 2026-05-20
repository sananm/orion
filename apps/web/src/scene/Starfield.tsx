import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { getGlowTexture } from './glowTexture';
import { stellarColor } from './starColors';

type LayerProps = {
  count: number;
  spreadX: number;
  spreadY: number;
  size: number;
  opacity: number;
  parallax: number;
  z: number;
  drift: number;
  cursorRadius: number;
  cursorStrength: number;
};

function StarLayer({ count, spreadX, spreadY, size, opacity, parallax, z, drift, cursorRadius, cursorStrength }: LayerProps) {
  const meshRef = useRef<THREE.Points>(null);
  const { camera } = useThree();

  const { geometry, positions, basePositions, phases, speeds, amplitudes } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const basePositions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    const amplitudes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * spreadX;
      const y = (Math.random() - 0.5) * spreadY;
      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      basePositions[i * 3 + 0] = x;
      basePositions[i * 3 + 1] = y;
      basePositions[i * 3 + 2] = z;
      const color = stellarColor(i * 17 + count * 3 + Math.round((z + 80) * 11));
      colors[i * 3 + 0] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      phases[i] = Math.random() * Math.PI * 2;
      speeds[i] = 0.18 + Math.random() * 0.52;
      amplitudes[i] = drift * (0.45 + Math.random() * 1.2);
    }
    const positionAttribute = new THREE.BufferAttribute(positions, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', positionAttribute);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return { geometry: g, positions, basePositions, phases, speeds, amplitudes };
  }, [count, drift, spreadX, spreadY, z]);

  const material = useMemo(() => {
    return new THREE.PointsMaterial({
      map: getGlowTexture(),
      size,
      sizeAttenuation: true,
      transparent: true,
      opacity,
      depthWrite: false,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
    });
  }, [size, opacity]);

  useFrame(({ clock, pointer, viewport }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    mesh.position.x = camera.position.x * (1 - parallax);
    mesh.position.y = camera.position.y * (1 - parallax);

    const time = clock.getElapsedTime();
    const localCursorX = camera.position.x + (pointer.x * viewport.width) / 2 - mesh.position.x;
    const localCursorY = camera.position.y + (pointer.y * viewport.height) / 2 - mesh.position.y;
    const radiusSq = cursorRadius * cursorRadius;

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      const baseX = basePositions[idx + 0];
      const baseY = basePositions[idx + 1];
      const phase = phases[i];
      const speed = speeds[i];
      const amplitude = amplitudes[i];

      let x = baseX + Math.sin(time * speed + phase) * amplitude;
      let y = baseY + Math.cos(time * speed * 0.87 + phase * 1.37) * amplitude;

      const dx = x - localCursorX;
      const dy = y - localCursorY;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < radiusSq) {
        const distance = Math.max(0.001, Math.sqrt(distanceSq));
        const force = (1 - distance / cursorRadius) * cursorStrength;
        x += (dx / distance) * force;
        y += (dy / distance) * force;
      }

      positions[idx + 0] = x;
      positions[idx + 1] = y;
    }

    const positionAttribute = geometry.getAttribute('position') as THREE.BufferAttribute;
    positionAttribute.needsUpdate = true;
  });

  return <points ref={meshRef} geometry={geometry} material={material} />;
}

export function Starfield() {
  const { viewport } = useThree();
  const width = Math.max(24, viewport.width * 1.7);
  const height = Math.max(16, viewport.height * 1.7);

  return (
    <group>
      <StarLayer
        count={760}
        spreadX={width}
        spreadY={height}
        size={1.7}
        opacity={0.42}
        parallax={0.03}
        z={-30}
        drift={0.32}
        cursorRadius={2.8}
        cursorStrength={0.22}
      />
      <StarLayer
        count={460}
        spreadX={width * 0.92}
        spreadY={height * 0.92}
        size={2.7}
        opacity={0.6}
        parallax={0.11}
        z={-20}
        drift={0.44}
        cursorRadius={3.4}
        cursorStrength={0.38}
      />
      <StarLayer
        count={280}
        spreadX={width * 0.82}
        spreadY={height * 0.82}
        size={3.8}
        opacity={0.8}
        parallax={0.24}
        z={-10}
        drift={0.62}
        cursorRadius={4.2}
        cursorStrength={0.62}
      />
    </group>
  );
}
