/**
 * Every adjustable knob, its default, and named presets.
 *
 * The working state is kept in localStorage so a reload keeps what was being
 * tried; named presets live beside it. A preset worth keeping for good is
 * exported as JSON and committed into `presets.json` — its "default" entry is
 * what everyone starts from.
 */

import {EVENT_TAGS, EventTag} from './model';
import presetsFile from './presets.json';

export type ColorBy = 'line' | 'evidence' | 'research' | 'sex' | 'generation' | 'surname';
export type Scope = 'all' | 'lineage' | 'ancestors' | 'descendants';
export type LabelMode = 'off' | 'selection' | 'near' | 'all';

export interface Settings {
  // Nodes
  showUnions: boolean;
  events: Record<EventTag, boolean>;
  showPlaces: boolean;
  showSources: boolean;
  personShape: 'sphere' | 'lifeline';
  photos: boolean;
  nodeSize: number;
  sizeBy: 'equal' | 'descendants' | 'sources';
  lifelineWidth: number;

  // Colours
  colorBy: ColorBy;
  background: string;
  glow: number;
  collateralFade: number;
  lineColors: string[];

  // Links
  linkOpacity: number;
  linkWidth: number;
  linkCurvature: number;
  linkColorMode: 'node' | 'single';
  linkColor: string;
  particles: boolean;
  particleSpeed: number;
  particleWidth: number;

  // Timeline
  axis: 'vertical' | 'depth';
  timeFlow: 'up' | 'down';
  timeMode: 'year' | 'generation';
  yearScale: number;
  generationSpacing: number;
  grid: boolean;
  gridRadius: number;
  gridOpacity: number;
  decades: boolean;
  cursor: boolean;
  cursorYear: number;
  cursorFollow: boolean;

  // Layout
  charge: number;
  linkDistance: number;
  lineSeparation: number;
  lineRadius: number;
  velocityDecay: number;

  // Effects
  bloom: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  fog: boolean;
  fogDensity: number;

  // Labels
  labels: LabelMode;
  labelSize: number;
  labelDistance: number;
  /** Names within this many screen pixels of the mouse pointer; 0 = off. */
  pointerRadius: number;
  pointerMax: number;

  // Filter
  scope: Scope;
  generations: number;
  showDetached: boolean;
  dimOpacity: number;
}

export const DEFAULTS: Settings = {
  showUnions: true,
  events: Object.fromEntries(EVENT_TAGS.map((t) => [t, false])) as Record<EventTag, boolean>,
  showPlaces: false,
  showSources: false,
  personShape: 'sphere',
  photos: true,
  nodeSize: 3,
  sizeBy: 'equal',
  lifelineWidth: 0.35,

  colorBy: 'line',
  background: '#070b16',
  glow: 0.55,
  collateralFade: 0.45,
  lineColors: ['#4f9dff', '#ff8a4c', '#3ddc97', '#c08bff', '#ffd166', '#ff5d8f', '#5ce1e6', '#b5e48c'],

  linkOpacity: 0.35,
  linkWidth: 0,
  linkCurvature: 0.12,
  linkColorMode: 'node',
  linkColor: '#8aa0c8',
  particles: false,
  particleSpeed: 0.006,
  particleWidth: 1.2,

  axis: 'vertical',
  timeFlow: 'up',
  timeMode: 'year',
  yearScale: 2.2,
  generationSpacing: 60,
  grid: true,
  gridRadius: 260,
  gridOpacity: 0.22,
  decades: true,
  cursor: false,
  cursorYear: 1850,
  cursorFollow: false,

  charge: -40,
  linkDistance: 22,
  lineSeparation: 0.15,
  lineRadius: 140,
  velocityDecay: 0.4,

  bloom: true,
  bloomStrength: 0.8,
  bloomRadius: 0.4,
  bloomThreshold: 0.2,
  fog: true,
  fogDensity: 0.0004,

  labels: 'selection',
  labelSize: 12,
  labelDistance: 180,
  pointerRadius: 45,
  pointerMax: 8,

  scope: 'all',
  generations: 0,
  showDetached: true,
  dimOpacity: 0.12,
};

const STATE_KEY = 'gedcom3d:settings';
const PRESETS_KEY = 'gedcom3d:presets';

type Presets = Record<string, Partial<Settings>>;

/**
 * Values early versions stored under German names. A saved state or preset
 * from then still loads: each is translated on the way in.
 */
const LEGACY: Partial<Record<keyof Settings, Record<string, string>>> = {
  personShape: {kugel: 'sphere', lebenslinie: 'lifeline'},
  sizeBy: {gleich: 'equal', nachkommen: 'descendants', belege: 'sources'},
  colorBy: {linie: 'line', evidenz: 'evidence', forschung: 'research', geschlecht: 'sex', nachname: 'surname'},
  linkColorMode: {knoten: 'node', einfarbig: 'single'},
  axis: {vertikal: 'vertical', tiefe: 'depth'},
  timeFlow: {aufwärts: 'up', abwärts: 'down'},
  timeMode: {jahr: 'year'},
  scope: {alle: 'all', verwandte: 'lineage', ahnen: 'ancestors', nachkommen: 'descendants'},
  labels: {aus: 'off', auswahl: 'selection', nah: 'near', alle: 'all'},
};

/** Merge a partial over defaults, dropping keys that no longer exist. */
export function merge(base: Settings, over: Partial<Settings> | undefined): Settings {
  const out = structuredClone(base);
  if (!over) return out;
  for (const k of Object.keys(base) as (keyof Settings)[]) {
    if (!(k in over)) continue;
    let v = over[k];
    const legacy = LEGACY[k];
    if (legacy && typeof v === 'string' && v in legacy) v = legacy[v] as never;
    if (k === 'events' && v && typeof v === 'object') {
      out.events = {...out.events, ...(v as Settings['events'])};
    } else if (v !== undefined) {
      (out as unknown as Record<string, unknown>)[k] = structuredClone(v);
    }
  }
  return out;
}

export function builtinPresets(): Presets {
  return presetsFile as Presets;
}

export const DEFAULT_PRESET = 'default';

export function standard(): Settings {
  return merge(DEFAULTS, builtinPresets()[DEFAULT_PRESET]);
}

function read<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private window or blocked storage: settings simply don't persist.
  }
}

/** Where the viewer kept its state before it was called gedcom-3d. */
const LEGACY_STATE_KEY = 'viewer3d:settings';
const LEGACY_PRESETS_KEY = 'viewer3d:presets';

export function loadState(): Settings {
  return merge(standard(), read<Partial<Settings>>(STATE_KEY) ?? read<Partial<Settings>>(LEGACY_STATE_KEY));
}

export function saveState(s: Settings) {
  write(STATE_KEY, s);
}

export function userPresets(): Presets {
  return read<Presets>(PRESETS_KEY) ?? read<Presets>(LEGACY_PRESETS_KEY) ?? {};
}

export function allPresets(): Presets {
  return {...builtinPresets(), ...userPresets()};
}

export function savePreset(name: string, s: Settings) {
  write(PRESETS_KEY, {...userPresets(), [name]: s});
}

export function deletePreset(name: string) {
  const p = userPresets();
  delete p[name];
  write(PRESETS_KEY, p);
}

/** Only what differs from the defaults — what a preset in presets.json should hold. */
export function diff(s: Settings): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (JSON.stringify(s[k]) !== JSON.stringify(DEFAULTS[k])) out[k] = s[k];
  }
  return out as Partial<Settings>;
}
