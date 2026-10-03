/**
 * The timeline itself: rings around the time axis at every decade, brighter
 * ones with a faint disc at every century, year labels on one side, the axis
 * line, and the year cursor. Built in local coordinates with time along +y;
 * the view rotates the group when time runs along the depth axis.
 */

import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import {t as tr} from '../i18n';
import {Settings} from '../settings';

export interface GridSpec {
  minYear: number;
  maxYear: number;
  genRange: [number, number];
  /** The band of nodes with nothing to date them, if any. */
  undated?: {coord: number; count: number};
  timeCoord(year: number): number;
  generationCoord(gen: number): number;
}

const RING_SEGMENTS = 128;
const ringGeometry = (() => {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const a = (i / RING_SEGMENTS) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
})();
const discGeometry = new THREE.CircleGeometry(1, RING_SEGMENTS).rotateX(-Math.PI / 2);

const GRID_COLOR = '#9fb4e0';
const CURSOR_COLOR = '#ffd166';
const UNDATED_COLOR = '#b184ff';

function ring(radius: number, t: number, color: string, opacity: number): THREE.LineLoop {
  const line = new THREE.LineLoop(
    ringGeometry,
    new THREE.LineBasicMaterial({color, transparent: true, opacity, depthWrite: false}),
  );
  line.scale.setScalar(radius);
  line.position.y = t;
  return line;
}

function disc(radius: number, t: number, color: string, opacity: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    discGeometry,
    new THREE.MeshBasicMaterial({color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false}),
  );
  mesh.scale.setScalar(radius);
  mesh.position.y = t;
  return mesh;
}

function label(text: string, radius: number, t: number, color: string, height: number, opacity: number): SpriteText {
  const s = new SpriteText(text, height, color);
  s.fontFace = 'system-ui, -apple-system, Helvetica, Arial, sans-serif';
  s.fontWeight = '600';
  const m = s.material as THREE.SpriteMaterial;
  m.transparent = true;
  m.opacity = opacity;
  m.depthWrite = false;
  s.position.set(radius + height * 2.2, t, 0);
  return s;
}

export function buildTimeGrid(group: THREE.Group, s: Settings, spec: GridSpec) {
  if (!s.grid) return;
  const R = s.gridRadius;
  const o = s.gridOpacity;

  if (spec.undated) {
    const t = spec.undated.coord;
    group.add(ring(R * 0.92, t, UNDATED_COLOR, Math.min(1, o * 2.6)));
    group.add(disc(R * 0.92, t, UNDATED_COLOR, o * 0.08));
    group.add(label(tr('grid.undated', {n: spec.undated.count}), R * 0.92, t, UNDATED_COLOR, Math.max(7, R * 0.045), Math.min(1, o * 4)));
  }

  if (s.timeMode === 'generation') {
    const [lo, hi] = spec.genRange;
    for (let g = lo; g <= hi; g++) {
      const t = spec.generationCoord(g);
      group.add(ring(R, t, GRID_COLOR, o * (g === 0 ? 2.5 : 1.2)));
      group.add(disc(R, t, GRID_COLOR, o * 0.08));
      group.add(label(g === 0 ? tr('grid.root') : tr(g > 0 ? 'grid.gen' : 'grid.genNeg', {n: g}), R, t, GRID_COLOR, 7, Math.min(1, o * 3.5)));
    }
    addAxis(group, spec.generationCoord(lo - 0.5), spec.generationCoord(hi + 0.5), o);
    return;
  }

  const from = Math.floor(spec.minYear / 10) * 10;
  const to = Math.ceil(spec.maxYear / 10) * 10;
  for (let y = from; y <= to; y += 10) {
    const t = spec.timeCoord(y);
    const century = y % 100 === 0;
    const half = y % 50 === 0;
    if (century) {
      group.add(ring(R, t, GRID_COLOR, Math.min(1, o * 2.6)));
      group.add(disc(R, t, GRID_COLOR, o * 0.09));
      group.add(label(String(y), R, t, GRID_COLOR, Math.max(9, R * 0.06), Math.min(1, o * 4)));
    } else if (s.decades) {
      group.add(ring(R * (half ? 1 : 0.985), t, GRID_COLOR, o * (half ? 0.9 : 0.4)));
      if (half) group.add(label(String(y), R, t, GRID_COLOR, Math.max(6, R * 0.035), Math.min(1, o * 2.6)));
    }
  }
  addAxis(group, spec.timeCoord(from - 5), spec.timeCoord(to + 5), o);

  if (s.cursor) {
    const t = spec.timeCoord(s.cursorYear);
    group.add(ring(R * 1.04, t, CURSOR_COLOR, 0.95));
    group.add(disc(R * 1.04, t, CURSOR_COLOR, 0.06));
    group.add(label(String(s.cursorYear), R * 1.04, t, CURSOR_COLOR, Math.max(11, R * 0.07), 1));
  }
}

function addAxis(group: THREE.Group, a: number, b: number, o: number) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, a, 0), new THREE.Vector3(0, b, 0)]);
  group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({color: GRID_COLOR, transparent: true, opacity: Math.min(1, o * 1.5), depthWrite: false})));
}
