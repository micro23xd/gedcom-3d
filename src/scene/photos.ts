/**
 * Portraits as node faces: the photo cut to a circle with a ring in the node's
 * colour. Photos load from the server the GEDCOM came from, relative to it;
 * until one has loaded, the disc shows the colour alone.
 */

import * as THREE from 'three';

const SIZE = 192;
const RING = 12;
const images = new Map<string, HTMLImageElement>();
const textures = new Map<string, THREE.CanvasTexture>();

function draw(canvas: HTMLCanvasElement, img: HTMLImageElement | undefined, color: string) {
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  const r = SIZE / 2;
  g.clearRect(0, 0, SIZE, SIZE);
  g.beginPath();
  g.arc(r, r, r - 1, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.save();
  g.beginPath();
  g.arc(r, r, r - RING, 0, Math.PI * 2);
  g.clip();
  if (img && img.naturalWidth) {
    // Cover-crop, biased to the upper part where faces usually are.
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - s) / 2;
    const sy = Math.max(0, (img.naturalHeight - s) * 0.25);
    g.drawImage(img, sx, sy, s, s, RING, RING, SIZE - 2 * RING, SIZE - 2 * RING);
  } else {
    g.fillStyle = '#0b1020';
    g.fill();
  }
  g.restore();
}

export function photoTexture(url: string, color: string): THREE.CanvasTexture {
  const key = `${url}|${color}`;
  const cached = textures.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, tex);

  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    images.set(url, img);
  }
  draw(canvas, img.complete ? img : undefined, color);
  if (!img.complete) {
    img.addEventListener('load', () => {
      draw(canvas, img, color);
      tex.needsUpdate = true;
    });
  }
  return tex;
}
