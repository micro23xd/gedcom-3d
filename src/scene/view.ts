/**
 * The 3D scene: the force graph with time pinned to one axis, the node
 * objects, the timeline grid, highlighting, labels and the camera.
 */

import ForceGraph3D, {ForceGraph3DInstance} from '3d-force-graph';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {OutputPass} from 'three/examples/jsm/postprocessing/OutputPass.js';
import {UnrealBloomPass} from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {CSS2DObject, CSS2DRenderer} from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {nodeColor} from '../colors';
import {Key, t as tr} from '../i18n';
import {Context, GLink, GNode, GraphData, lineageNodeIds} from '../graph';
import {Settings} from '../settings';
import {aliveIn} from '../timeline';
import {buildTimeGrid} from './timegrid';
import {photoTexture} from './photos';

const NOW = new Date().getFullYear();
const BASE_YEAR = 1800;
/** Overview distance of a tree our size, at which `fogDensity` looks as set. */
const FOG_REFERENCE = 2000;

interface Visual {
  node: GNode;
  group: THREE.Group;
  materials: (THREE.Material & {opacity: number})[];
  baseOpacity: number[];
  label?: CSS2DObject;
  size: number;
}

export interface ViewCallbacks {
  onSelect(node: GNode | null): void;
  onHover(node: GNode | null): void;
}

const geometries = {
  sphere: new THREE.SphereGeometry(1, 24, 16),
  sphereLow: new THREE.SphereGeometry(1, 10, 7),
  union: new THREE.OctahedronGeometry(1),
  event: new THREE.TetrahedronGeometry(1),
  place: new THREE.BoxGeometry(1.4, 1.4, 1.4),
  source: new THREE.CylinderGeometry(1, 1, 0.5, 6),
  rod: new THREE.CylinderGeometry(1, 1, 1, 8, 1, true),
};

function isPersonNode(n: GNode) {
  return n.kind === 'person';
}

export class View {
  readonly graph: ForceGraph3DInstance<GNode, GLink>;
  private s: Settings;
  private data: GraphData = {nodes: [], links: [], undatedEvents: 0};
  private visuals = new Map<string, Visual>();
  private highlight: Set<string> | null = null;
  private selected: GNode | null = null;
  private hovered: GNode | null = null;
  private grid = new THREE.Group();
  private bloom: UnrealBloomPass;
  private labelTimer = 0;
  private generationRange: [number, number] = [0, 0];

  constructor(
    private container: HTMLElement,
    public ctx: Context,
    settings: Settings,
    private cb: ViewCallbacks,
  ) {
    this.s = settings;
    this.graph = new ForceGraph3D(container, {controlType: 'orbit', extraRenderers: [new CSS2DRenderer() as never]}) as unknown as ForceGraph3DInstance<GNode, GLink>;
    const g = this.graph;
    g.nodeId('id')
      .showNavInfo(false)
      .enableNodeDrag(false)
      .nodeLabel((n: GNode) => this.tooltip(n))
      .nodeThreeObject((n: GNode) => this.makeObject(n))
      .onNodeClick((n: GNode) => this.cb.onSelect(n))
      .onBackgroundClick(() => this.cb.onSelect(null))
      .onNodeHover((n: GNode | null) => {
        this.hovered = n;
        container.style.cursor = n ? 'pointer' : '';
        this.cb.onHover(n);
        this.updateLabels();
      })
      .onEngineStop(() => this.savePositions())
      .warmupTicks(0)
      .cooldownTicks(400);

    const controls = g.controls() as OrbitControls;
    controls.screenSpacePanning = true;
    controls.zoomSpeed = 1.4;
    controls.addEventListener('change', () => {
      this.scheduleCameraSave();
      // The camera moved under a still pointer: other names are near it now.
      if (this.pointer) this.scheduleLabels();
    });

    this.bloom = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 1, 0.5, 0.1);
    // The bloom pass works in linear HDR; the output pass converts back to
    // sRGB, without which the whole frame comes out washed-out.
    g.postProcessingComposer().addPass(this.bloom);
    g.postProcessingComposer().addPass(new OutputPass());
    g.scene().add(this.grid);

    this.installTimeTravel();
    this.installPointerNames();
    window.addEventListener('resize', () => g.width(container.clientWidth).height(container.clientHeight));
    this.labelTimer = window.setInterval(() => {
      if (this.s.labels === 'near') this.updateLabels();
    }, 300);
    this.applyStyle();
  }

  // --- time axis -----------------------------------------------------------

  private get dir() {
    return this.s.timeFlow === 'up' ? 1 : -1;
  }

  /** World coordinate along the time axis for a year. */
  timeCoord(year: number): number {
    return (year - BASE_YEAR) * this.s.yearScale * this.dir;
  }

  private generationCoord(gen: number): number {
    return -gen * this.s.generationSpacing * this.dir;
  }

  /** The year range in view and where the band of undated nodes sits. */
  private yearRange: [number, number] = [1700, 2000];

  private measure() {
    const years = this.data.nodes.map((n) => n.year).filter((y): y is number => y !== undefined);
    this.yearRange = years.length ? [Math.min(...years), Math.max(...years)] : [1700, 2000];
    const gens = this.data.nodes
      .filter((n) => n.kind === 'person')
      .map((n) => this.ctx.generations.get(n.ref))
      .filter((g): g is number => g !== undefined);
    this.generationRange = gens.length ? [Math.min(...gens), Math.max(...gens)] : [0, 0];
  }

  /**
   * Nodes with nothing to date them — no date of their own, none on any
   * relative — sit on a band of their own below the oldest year rather than
   * drift along the time axis.
   */
  private undatedCoord(): number {
    return this.s.timeMode === 'generation'
      ? this.generationCoord(this.generationRange[1] + 1.5)
      : this.timeCoord(Math.floor(this.yearRange[0] / 10) * 10 - 40);
  }

  /** The time-axis coordinate a node is pinned to, and whether that is the undated band. */
  private pinFor(n: GNode): {t: number; undated: boolean} {
    const at = (t: number | undefined) => (t === undefined ? {t: this.undatedCoord(), undated: true} : {t, undated: false});
    if (this.s.timeMode === 'generation') {
      const gens = this.ctx.generations;
      if (n.kind === 'person') {
        const g = gens.get(n.ref);
        return at(g === undefined ? undefined : this.generationCoord(g));
      }
      if (n.kind === 'union') {
        const fam = this.ctx.tree.families.get(n.ref);
        const gs = [fam?.husb, fam?.wife].map((x) => (x ? gens.get(x) : undefined)).filter((x): x is number => x !== undefined);
        return at(gs.length ? this.generationCoord(Math.min(...gs) - 0.5) : undefined);
      }
      if (n.kind === 'event' && n.owner) {
        const g = gens.get(n.owner);
        return at(g === undefined ? undefined : this.generationCoord(g - 0.25));
      }
      return at(undefined);
    }
    return at(n.year === undefined ? undefined : this.timeCoord(n.year));
  }

  private undatedIds = new Set<string>();

  private pin(n: GNode) {
    const {t, undated} = this.pinFor(n);
    if (undated) this.undatedIds.add(n.id);
    if (this.s.axis === 'vertical') {
      n.fz = undefined;
      n.fy = t;
      n.y = t;
    } else {
      n.fy = undefined;
      n.fz = t;
      n.z = t;
    }
  }

  /** Swap a node's coordinates into the plane perpendicular to the time axis. */
  private plane(n: GNode): [number, number] {
    return this.s.axis === 'vertical' ? [n.x ?? 0, n.z ?? 0] : [n.x ?? 0, n.y ?? 0];
  }

  // --- data ----------------------------------------------------------------

  setData(data: GraphData) {
    const old = new Map(this.data.nodes.map((n) => [n.id, n]));
    const cached = this.loadPositions();
    for (const n of data.nodes) {
      const prev = old.get(n.id);
      const pos = prev ? [prev.x, prev.y, prev.z] : cached[n.id];
      if (pos) [n.x, n.y, n.z] = pos as number[];
    }
    this.data = data;
    this.pinAll();
    this.dropLabels();
    this.visuals.clear();
    if (this.selected) this.selected = data.nodes.find((n) => n.id === this.selected?.id) ?? null;
    if (this.selected?.kind === 'person') this.highlight = lineageNodeIds(this.ctx, this.selected.ref, data);
    else this.highlight = null;
    this.installForces();
    this.graph.graphData(data);
    this.buildGrid();
  }

  /** Before a different file: nothing of the old graph may seed the new one. */
  forget() {
    this.data = {nodes: [], links: [], undatedEvents: 0};
    this.selected = null;
    this.highlight = null;
    this.hovered = null;
  }

  nodes(): GNode[] {
    return this.data.nodes;
  }

  findPerson(id: string): GNode | undefined {
    return this.data.nodes.find((n) => n.id === `p:${id}`);
  }

  // --- forces --------------------------------------------------------------

  private installForces() {
    const g = this.graph;
    const s = this.s;
    const charge = g.d3Force('charge') as unknown as {strength(v: number): unknown; distanceMax(v: number): unknown};
    charge.strength(s.charge);
    charge.distanceMax(420);
    const link = g.d3Force('link') as unknown as {
      distance(f: (l: GLink) => number): unknown;
      strength(f: (l: GLink) => number): unknown;
    };
    link.distance((l) => (l.kind === 'event' ? 4 : l.kind === 'place' || l.kind === 'source' ? s.linkDistance * 2 : s.linkDistance));
    link.strength((l) => (l.kind === 'place' || l.kind === 'source' ? 0.05 : l.kind === 'event' ? 0.9 : 0.5));
    g.d3VelocityDecay(s.velocityDecay);

    // Pull each line into its own sector around the time axis, and snap
    // events onto the person or union they belong to.
    const nodeById = new Map(this.data.nodes.map((n) => [n.id, n]));
    const lineCount = Math.max(1, this.ctx.lines.length);
    const targets = new Map<string, [number, number]>();
    const personTarget = (id: string): [number, number] | undefined => {
      const info = this.ctx.lineInfo.get(id);
      if (!info) return undefined;
      if (info.core) return [0, 0];
      if (!info.lines.length) return undefined;
      let a = 0;
      let b = 0;
      for (const i of info.lines) {
        const th = (2 * Math.PI * i) / lineCount;
        a += Math.cos(th);
        b += Math.sin(th);
      }
      const r = (s.lineRadius * (info.collateral ? 1.25 : 1)) / info.lines.length;
      return [a * r, b * r];
    };
    for (const n of this.data.nodes) {
      if (n.kind === 'person') {
        const t = personTarget(n.ref);
        if (t) targets.set(n.id, t);
      } else if (n.kind === 'union') {
        const fam = this.ctx.tree.families.get(n.ref);
        const ts = [fam?.husb, fam?.wife].map((x) => (x ? personTarget(x) : undefined)).filter((x): x is [number, number] => !!x);
        if (ts.length) targets.set(n.id, [ts.reduce((a, t) => a + t[0], 0) / ts.length, ts.reduce((a, t) => a + t[1], 0) / ts.length]);
      }
    }
    const snap = new Map<string, GNode>();
    for (const l of this.data.links) {
      if (l.kind !== 'event') continue;
      const src = typeof l.source === 'string' ? nodeById.get(l.source) : l.source;
      const tgtId = typeof l.target === 'string' ? l.target : l.target.id;
      if (src && !snap.has(tgtId)) snap.set(tgtId, src);
    }

    let nodes: GNode[] = [];
    const vertical = s.axis === 'vertical';
    const force = (alpha: number) => {
      const k = s.lineSeparation * alpha;
      for (const n of nodes) {
        const owner = snap.get(n.id);
        if (owner) {
          const [oa, ob] = this.plane(owner);
          const [na, nb] = this.plane(n);
          n.vx = (n.vx ?? 0) + (oa - na) * 0.4;
          if (vertical) n.vz = (n.vz ?? 0) + (ob - nb) * 0.4;
          else n.vy = (n.vy ?? 0) + (ob - nb) * 0.4;
          continue;
        }
        // Nodes of no line (detached fragments, hubs) drift off under the
        // charge; a weak pull keeps them near the axis.
        const t = targets.get(n.id) ?? ([0, 0] as [number, number]);
        const kk = targets.has(n.id) ? k : 0.02 * alpha;
        if (kk === 0) continue;
        const [na, nb] = this.plane(n);
        n.vx = (n.vx ?? 0) + (t[0] - na) * kk;
        if (vertical) n.vz = (n.vz ?? 0) + (t[1] - nb) * kk;
        else n.vy = (n.vy ?? 0) + (t[1] - nb) * kk;
      }
    };
    (force as unknown as {initialize: (ns: GNode[]) => void}).initialize = (ns: GNode[]) => {
      nodes = ns;
    };
    g.d3Force('lines', force as never);
  }

  // --- node objects ----------------------------------------------------------

  private sizeOf(n: GNode): number {
    const k = {person: 1, union: 0.45, event: 0.55, place: 0.8, source: 0.8}[n.kind];
    return this.s.nodeSize * k * n.weight;
  }

  private makeObject(n: GNode): THREE.Object3D {
    const s = this.s;
    const color = nodeColor(this.ctx, s, n);
    const size = this.sizeOf(n);
    const group = new THREE.Group();
    const visual: Visual = {node: n, group, materials: [], baseOpacity: [], size};
    const addMat = <M extends THREE.Material & {opacity: number}>(m: M, base: number): M => {
      m.transparent = true;
      m.opacity = base;
      visual.materials.push(m);
      visual.baseOpacity.push(base);
      return m;
    };
    const glowMat = (base: number, wire = false) =>
      addMat(
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: s.glow,
          roughness: 0.45,
          metalness: 0.1,
          wireframe: wire,
        }),
        base,
      );

    const person = n.kind === 'person';
    const estimated = n.estimated && person;
    const photo = person && s.photos ? this.photoFor(n.ref) : undefined;

    if (photo) {
      const tex = photoTexture(photo, color);
      const sprite = new THREE.Sprite(addMat(new THREE.SpriteMaterial({map: tex, depthWrite: false}), 1));
      sprite.scale.setScalar(size * 2.6);
      group.add(sprite);
    } else {
      const geo = {
        person: estimated ? geometries.sphereLow : geometries.sphere,
        union: geometries.union,
        event: geometries.event,
        place: geometries.place,
        source: geometries.source,
      }[n.kind];
      const mesh = new THREE.Mesh(geo, glowMat(estimated ? 0.6 : 0.95, estimated));
      mesh.scale.setScalar(person && s.personShape === 'lifeline' ? size * 0.7 : size);
      group.add(mesh);
    }

    if (person && s.personShape === 'lifeline' && s.timeMode === 'year' && n.year !== undefined) {
      const t = this.ctx.times.persons.get(n.ref);
      const known = t?.death !== undefined;
      const end = t?.death ?? Math.min(n.year + 60, NOW);
      const len = Math.max(0.5, (end - n.year) * s.yearScale);
      const rod = new THREE.Mesh(geometries.rod, glowMat(known ? 0.75 : 0.28));
      rod.scale.set(s.lifelineWidth, len, s.lifelineWidth);
      rod.position.y = (len / 2) * this.dir;
      const holder = new THREE.Group();
      holder.add(rod);
      if (known) {
        const bead = new THREE.Mesh(geometries.sphereLow, glowMat(0.8));
        bead.scale.setScalar(size * 0.35);
        bead.position.y = len * this.dir;
        holder.add(bead);
      }
      if (s.axis === 'depth') holder.rotation.x = Math.PI / 2;
      group.add(holder);
    }

    this.visuals.get(n.id)?.label?.element.remove();
    this.visuals.set(n.id, visual);
    this.applyVisualState(visual);
    return group;
  }

  private photoFor(personId: string): string | undefined {
    const p = this.ctx.tree.persons.get(personId);
    for (const m of p?.media ?? []) {
      const media = this.ctx.tree.media.get(m);
      if (media?.url && /\.(jpe?g|png|webp)$/i.test(media.url)) return media.url;
    }
    return undefined;
  }

  private tooltip(n: GNode): string {
    const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c] as string);
    if (n.kind === 'person') {
      const t = this.ctx.times.persons.get(n.ref);
      const p = this.ctx.tree.persons.get(n.ref);
      const b = p?.events.find((e) => (e.tag === 'BIRT' || e.tag === 'CHR') && e.date)?.date?.year;
      const d = p?.events.find((e) => (e.tag === 'DEAT' || e.tag === 'BURI') && e.date)?.date?.year;
      const life = b || d ? `${b ?? '?'}–${d ?? ''}` : t?.year !== undefined ? tr('tip.estimated', {year: t.year}) : tr('tip.undated');
      return `<b>${esc(n.label)}</b>${life ? `<br><span>${esc(life)}</span>` : ''}`;
    }
    const kind = tr(`kind.${n.kind}` as Key);
    return `<span>${kind}</span><br><b>${esc(n.label)}</b>`;
  }

  // --- highlight, dimming, labels ---------------------------------------------

  private dimmed(n: GNode): boolean {
    if (this.highlight && !this.highlight.has(n.id)) return true;
    if (this.s.cursor && this.s.timeMode === 'year' && n.kind === 'person') {
      const t = this.ctx.times.persons.get(n.ref);
      if (!t || !aliveIn(t, this.s.cursorYear, NOW)) return true;
    }
    return false;
  }

  private applyVisualState(v: Visual) {
    const dim = this.dimmed(v.node);
    v.materials.forEach((m, i) => {
      m.opacity = v.baseOpacity[i] * (dim ? this.s.dimOpacity : 1);
      m.depthWrite = !dim && m.opacity > 0.9;
    });
    if (v.label) v.label.element.style.opacity = dim ? String(Math.max(0.25, this.s.dimOpacity)) : '1';
  }

  private restyleAll() {
    for (const v of this.visuals.values()) this.applyVisualState(v);
    this.graph.linkOpacity(this.highlight ? 1 : this.s.linkOpacity);
    this.graph.linkColor((l: GLink) => this.linkRgba(l));
    this.updateLabels();
  }

  select(n: GNode | null) {
    this.selected = n;
    this.highlight = n?.kind === 'person' ? lineageNodeIds(this.ctx, n.ref, this.data) : n ? new Set([n.id]) : null;
    if (n && n.kind !== 'person') {
      for (const l of this.data.links) {
        const a = typeof l.source === 'string' ? l.source : l.source.id;
        const b = typeof l.target === 'string' ? l.target : l.target.id;
        if (a === n.id) this.highlight?.add(b);
        if (b === n.id) this.highlight?.add(a);
      }
    }
    this.restyleAll();
  }

  /**
   * Names are HTML (CSS2D), not sprites: crisp at any distance and untouched
   * by the bloom pass, which would smear white text.
   */
  private labelFor(v: Visual): CSS2DObject {
    if (!v.label) {
      const el = document.createElement('div');
      el.className = `node-label kind-${v.node.kind}`;
      el.textContent = v.node.kind === 'person' ? v.node.label : v.node.label.slice(0, 48);
      const label = new CSS2DObject(el);
      label.center.set(0.5, 1.4);
      v.group.add(label);
      v.label = label;
    }
    return v.label;
  }

  /** CSS2D elements nested in a node group outlive its removal; drop them. */
  private dropLabels() {
    for (const v of this.visuals.values()) v.label?.element.remove();
  }

  // --- names around the pointer ---------------------------------------------------

  /** Pointer position in canvas pixels, while it is over the scene. */
  private pointer: {x: number; y: number} | null = null;
  private dragging = false;
  private labelFrame = 0;

  private installPointerNames() {
    const el = this.container;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      this.pointer = {x: e.clientX - r.left, y: e.clientY - r.top};
      this.dragging = e.buttons !== 0;
      // Rotating with the button held: recompute on release, not every frame.
      if (!this.dragging) this.scheduleLabels();
    });
    el.addEventListener('pointerup', () => {
      this.dragging = false;
      this.scheduleLabels();
    });
    el.addEventListener('pointerleave', () => {
      this.pointer = null;
      this.scheduleLabels();
    });
  }

  /** At most one label pass per animation frame. */
  private scheduleLabels() {
    if (this.labelFrame) return;
    this.labelFrame = requestAnimationFrame(() => {
      this.labelFrame = 0;
      this.updateLabels();
    });
  }

  /** Nodes within `pointerRadius` screen pixels of the pointer, nearest first. */
  private nearPointer(): string[] {
    const {pointerRadius, pointerMax} = this.s;
    if (!this.pointer || pointerRadius <= 0 || this.dragging) return [];
    const cam = this.graph.camera() as THREE.PerspectiveCamera;
    const v = new THREE.Vector3();
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const hits: [number, string][] = [];
    for (const n of this.data.nodes) {
      if (n.kind === 'union') continue;
      v.set(n.x ?? 0, n.y ?? 0, n.z ?? 0).project(cam);
      if (v.z > 1 || v.z < -1) continue; // behind the camera or past the far plane
      const dx = ((v.x + 1) / 2) * w - this.pointer.x;
      const dy = ((1 - v.y) / 2) * h - this.pointer.y;
      const d = Math.hypot(dx, dy);
      if (d <= pointerRadius) hits.push([d, n.id]);
    }
    hits.sort((a, b) => a[0] - b[0]);

    // Nearest first; a name whose box would overlap one already placed is
    // left out rather than printed on top of it. The box is estimated from
    // the text length — measuring the DOM for every candidate would be slow.
    const size = this.s.labelSize;
    const placed: [number, number, number, number][] = [];
    const out: string[] = [];
    const byId = new Map(this.data.nodes.map((n) => [n.id, n]));
    for (const [, id] of hits) {
      if (out.length >= pointerMax) break;
      const n = byId.get(id) as GNode;
      v.set(n.x ?? 0, n.y ?? 0, n.z ?? 0).project(cam);
      const sx = ((v.x + 1) / 2) * w;
      const sy = ((1 - v.y) / 2) * h;
      const text = n.kind === 'person' ? n.label : n.label.slice(0, 48);
      const bw = text.length * size * 0.56 + 12;
      const bh = size * 1.2 + 2;
      // CSS2D centre (0.5, 1.4): the box sits just above the node.
      const box: [number, number, number, number] = [sx - bw / 2, sy - bh * 1.4, sx + bw / 2, sy - bh * 0.4];
      if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
      placed.push(box);
      out.push(id);
    }
    return out;
  }

  updateLabels() {
    const mode = this.s.labels;
    const want = new Set<string>();
    const near = new Set(mode === 'off' ? [] : this.nearPointer());
    if (mode !== 'off') {
      if (this.hovered) want.add(this.hovered.id);
      if (this.selected) {
        want.add(this.selected.id);
        // The direct family of the selection, not the whole lineage.
        for (const l of this.data.links) {
          const a = typeof l.source === 'string' ? l.source : l.source.id;
          const b = typeof l.target === 'string' ? l.target : l.target.id;
          if (a === this.selected.id) want.add(b);
          if (b === this.selected.id) want.add(a);
        }
        for (const id of [...want]) {
          if (!id.startsWith('f:')) continue;
          want.delete(id);
          for (const l of this.data.links) {
            const a = typeof l.source === 'string' ? l.source : l.source.id;
            const b = typeof l.target === 'string' ? l.target : l.target.id;
            if (a === id) want.add(b);
            if (b === id) want.add(a);
          }
        }
      }
      for (const id of near) want.add(id);
      if (mode === 'all') for (const n of this.data.nodes) if (isPersonNode(n)) want.add(n.id);
      if (mode === 'near') {
        const cam = this.graph.camera().position;
        const near: [number, string][] = [];
        for (const n of this.data.nodes) {
          if (!isPersonNode(n) || this.dimmed(n)) continue;
          const d = cam.distanceTo(new THREE.Vector3(n.x ?? 0, n.y ?? 0, n.z ?? 0));
          if (d < this.s.labelDistance) near.push([d, n.id]);
        }
        near.sort((a, b) => a[0] - b[0]);
        for (const [, id] of near.slice(0, 80)) want.add(id);
      }
    }
    // Labels of node objects the graph has since replaced would otherwise
    // linger in the DOM at their last position.
    const live = new Set<Element>();
    for (const v of this.visuals.values()) if (v.label) live.add(v.label.element);
    this.container.querySelectorAll('.node-label').forEach((el) => {
      if (!live.has(el)) el.remove();
    });
    for (const [id, v] of this.visuals) {
      if (want.has(id)) {
        const label = this.labelFor(v);
        label.visible = true;
        const exact = id === this.selected?.id || id === this.hovered?.id;
        label.element.classList.toggle('selected', exact);
        // Names only near the pointer step back behind the one under it.
        const nearOnly = near.has(id) && !exact;
        label.element.classList.toggle('near', nearOnly);
        label.element.style.opacity = this.dimmed(v.node)
          ? String(Math.max(0.25, this.s.dimOpacity))
          : nearOnly ? '0.85' : '1';
      } else if (v.label) {
        v.label.visible = false;
      }
    }
  }

  // --- links ---------------------------------------------------------------------

  private linkRgba(l: GLink): string {
    const s = this.s;
    const src = typeof l.source === 'string' ? undefined : l.source;
    const tgt = typeof l.target === 'string' ? undefined : l.target;
    let color = s.linkColor;
    if (s.linkColorMode === 'node') {
      const end = l.kind === 'partner' ? src : tgt;
      if (end) color = nodeColor(this.ctx, s, end.kind === 'union' && src ? src : end);
    }
    const c = new THREE.Color(color);
    // With a selection the global link opacity is 1 and the rest is dimmed
    // per link; tinycolor clamps alpha to 1, so it cannot be raised instead.
    let alpha = 1;
    if (this.highlight) {
      const on = src && tgt && this.highlight.has(src.id) && this.highlight.has(tgt.id);
      alpha = on ? 0.9 : s.linkOpacity * s.dimOpacity;
    }
    if (l.kind === 'place' || l.kind === 'source') alpha *= 0.5;
    return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${alpha})`;
  }

  // --- style ---------------------------------------------------------------------

  /** Apply everything that does not need a new graph. */
  applyStyle(s: Settings = this.s) {
    this.s = s;
    const g = this.graph;
    g.backgroundColor(s.background)
      .linkOpacity(this.highlight ? 1 : s.linkOpacity)
      .linkWidth(s.linkWidth)
      .linkCurvature(s.linkCurvature)
      .linkColor((l: GLink) => this.linkRgba(l))
      .linkDirectionalParticles(s.particles ? 2 : 0)
      .linkDirectionalParticleSpeed(s.particleSpeed)
      .linkDirectionalParticleWidth(s.particleWidth);
    const scene = g.scene();
    // The renderer's clear colour reaches the post-processing target without
    // colour management and comes out sRGB-encoded twice (a grey veil);
    // scene.background is converted properly.
    scene.background = new THREE.Color(s.background);
    this.updateFog();
    this.bloom.enabled = s.bloom;
    this.bloom.strength = s.bloomStrength;
    this.bloom.radius = s.bloomRadius;
    this.bloom.threshold = s.bloomThreshold;
    this.container.style.setProperty('--label-size', `${s.labelSize}px`);
  }

  /** Rebuild the node objects (shape, size, colour, glow). */
  rebuildObjects() {
    this.dropLabels();
    this.visuals.clear();
    this.graph.refresh();
    this.updateLabels();
  }

  /** Re-pin to the time axis (scale, axis, mode changed) and let the layout settle. */
  private pinAll() {
    this.measure();
    this.undatedIds.clear();
    for (const n of this.data.nodes) this.pin(n);
  }

  repin() {
    this.pinAll();
    this.installForces();
    this.rebuildObjects();
    this.buildGrid();
    this.graph.d3ReheatSimulation();
  }

  relayout() {
    this.installForces();
    this.graph.d3ReheatSimulation();
  }

  setCursor() {
    this.buildGrid();
    this.restyleAll();
    if (this.s.cursor && this.s.cursorFollow) this.travelTo(this.s.cursorYear);
  }

  refreshHighlight() {
    this.restyleAll();
  }

  private buildGrid() {
    this.grid.clear();
    buildTimeGrid(this.grid, this.s, {
      minYear: this.yearRange[0],
      maxYear: this.yearRange[1],
      genRange: this.generationRange,
      undated: this.undatedIds.size
        ? {coord: this.undatedCoord(), count: this.data.nodes.filter((n) => n.kind === 'person' && this.undatedIds.has(n.id)).length}
        : undefined,
      timeCoord: (y) => this.timeCoord(y),
      generationCoord: (g) => this.generationCoord(g),
    });
    this.grid.rotation.x = this.s.axis === 'depth' ? Math.PI / 2 : 0;
  }

  // --- camera ----------------------------------------------------------------------

  private axisVector(): THREE.Vector3 {
    return this.s.axis === 'vertical' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  }

  /** Move camera and target together along the time axis. */
  travel(delta: number) {
    const controls = this.graph.controls() as OrbitControls;
    const v = this.axisVector().multiplyScalar(delta);
    this.graph.camera().position.add(v);
    controls.target.add(v);
    controls.update();
    this.scheduleCameraSave();
  }

  travelTo(year: number) {
    const controls = this.graph.controls() as OrbitControls;
    const axis = this.axisVector();
    const current = controls.target.dot(axis);
    this.travel(this.timeCoord(year) - current);
  }

  private installTimeTravel() {
    this.container.addEventListener(
      'wheel',
      (e) => {
        if (!e.shiftKey) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const d = e.deltaY || e.deltaX;
        this.travel(-d * 0.35);
      },
      {capture: true, passive: false},
    );
  }

  flyTo(n: GNode, ms = 1100) {
    const target = new THREE.Vector3(n.x ?? 0, n.y ?? 0, n.z ?? 0);
    const cam = this.graph.camera().position.clone();
    const controls = this.graph.controls() as OrbitControls;
    const dir = cam.sub(controls.target).normalize();
    const pos = target.clone().add(dir.multiplyScalar(170));
    this.graph.cameraPosition({x: pos.x, y: pos.y, z: pos.z}, {x: target.x, y: target.y, z: target.z}, ms);
  }

  overview(ms = 800) {
    // Fit the bulk of the tree, not the stray detached fragments: percentiles
    // across the time axis, the full range along it.
    const ps = this.data.nodes.filter((n) => n.kind === 'person' && !this.undatedIds.has(n.id));
    if (!ps.length) return;
    const q = (xs: number[], f: number) => {
      const sorted = [...xs].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(f * (sorted.length - 1))))];
    };
    // Along time, a stray date centuries before everyone else (a legendary
    // forebear, a typo) would shrink the whole tree to a dot; the oldest
    // percent is allowed to fall outside the frame.
    const range = (k: 'x' | 'y' | 'z', along: boolean): [number, number] => {
      const xs = ps.map((n) => n[k] ?? 0);
      return along ? [q(xs, 0.01), q(xs, 0.995)] : [q(xs, 0.02), q(xs, 0.98)];
    };
    const box = {
      x: range('x', false),
      y: range('y', this.s.axis === 'vertical'),
      z: range('z', this.s.axis === 'depth'),
    };
    const c = new THREE.Vector3((box.x[0] + box.x[1]) / 2, (box.y[0] + box.y[1]) / 2, (box.z[0] + box.z[1]) / 2);
    const cam = this.graph.camera() as THREE.PerspectiveCamera;
    const vfov = (cam.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
    // Fit the time extent into the vertical field and the breadth into the
    // horizontal one, with room for the bars at the top and bottom.
    const vertical = this.s.axis === 'vertical';
    const along = vertical ? box.y[1] - box.y[0] : box.z[1] - box.z[0];
    const across = Math.max(box.x[1] - box.x[0], vertical ? box.z[1] - box.z[0] : box.y[1] - box.y[0]);
    const d = Math.max(along / 2 / Math.tan(vfov / 2), across / 2 / Math.tan(hfov / 2)) * 1.35;
    // Tunnel: stand just past the newest end and look back down the years.
    const pos = vertical
      ? {x: c.x + d * 0.26, y: c.y, z: c.z + d * 0.97}
      : {x: c.x + across * 0.12, y: c.y + across * 0.3, z: c.z + this.dir * (along / 2 + across * 1.2)};
    this.graph.cameraPosition(pos, {x: c.x, y: c.y, z: c.z}, ms);
    this.viewScale = d;
    this.updateFog();
  }

  /**
   * The fog density is set for a tree the size of ours; a larger tree is seen
   * from further away and would vanish in the same fog, so it thins with the
   * overview distance.
   */
  private viewScale = FOG_REFERENCE;

  private updateFog() {
    const s = this.s;
    const density = s.fogDensity * (FOG_REFERENCE / Math.max(FOG_REFERENCE, this.viewScale));
    this.graph.scene().fog = s.fog ? new THREE.FogExp2(s.background, density) : null;
  }

  // --- persistence across the watch reload -------------------------------------------

  private source = '';

  /** Which file is shown: positions and camera are remembered per file. */
  setSource(source: string) {
    this.source = source;
  }

  private key(what: string) {
    return `gedcom3d:${what}:${this.source}:${location.pathname}${location.search}`;
  }

  private savePositions() {
    const out: Record<string, [number, number, number]> = {};
    for (const n of this.data.nodes) out[n.id] = [Math.round(n.x ?? 0), Math.round(n.y ?? 0), Math.round(n.z ?? 0)];
    try {
      sessionStorage.setItem(this.key('pos'), JSON.stringify(out));
    } catch {
      // storage unavailable: the layout simply starts fresh next time
    }
  }

  private loadPositions(): Record<string, [number, number, number]> {
    try {
      return JSON.parse(sessionStorage.getItem(this.key('pos')) ?? '{}');
    } catch {
      return {};
    }
  }

  private cameraSave = 0;

  private scheduleCameraSave() {
    window.clearTimeout(this.cameraSave);
    this.cameraSave = window.setTimeout(() => {
      const cam = this.graph.camera().position;
      const t = (this.graph.controls() as OrbitControls).target;
      try {
        sessionStorage.setItem(this.key('camera'), JSON.stringify([cam.x, cam.y, cam.z, t.x, t.y, t.z]));
      } catch {
        // ignore
      }
    }, 400);
  }

  /** Restore the camera from before a reload; false when there was none. */
  restoreCamera(): boolean {
    try {
      const raw = sessionStorage.getItem(this.key('camera'));
      if (!raw) return false;
      const [x, y, z, tx, ty, tz] = JSON.parse(raw) as number[];
      this.graph.cameraPosition({x, y, z}, {x: tx, y: ty, z: tz}, 0);
      return true;
    } catch {
      return false;
    }
  }

  dispose() {
    window.clearInterval(this.labelTimer);
    this.graph._destructor();
  }
}
