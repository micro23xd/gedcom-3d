/**
 * Node colours for each colour scheme, and the legend that explains them.
 */

import {Color} from 'three';
import {Bucket} from './evidence';
import {Context, GNode} from './graph';
import {Key, t} from './i18n';
import {EventTag} from './model';
import {Settings} from './settings';

export const EVIDENCE_COLORS: Record<Bucket, string> = {
  record: '#3fcf6e',
  secondary: '#4ea8ff',
  hint: '#f0b429',
  unsourced: '#ff5c5c',
  none: '#6b7489',
};

export function evidenceLabel(b: Bucket): string {
  return t(`bucket.${b}` as Key);
}

export const QUAY_COLORS = ['#f0b429', '#f0b429', '#4ea8ff', '#3fcf6e'];

export const EVENT_COLORS: Record<EventTag, string> = {
  BIRT: '#7ee787',
  CHR: '#79c0ff',
  RELI: '#e6edf3',
  OCCU: '#ffa657',
  RESI: '#39d0c8',
  EMIG: '#ff7eb6',
  EVEN: '#ff6b6b',
  MARR: '#ffd33d',
  DIV: '#b08968',
  DEAT: '#a5a5c8',
  BURI: '#707090',
};

export const CORE_COLOR = '#fff4dc';
export const UNION_COLOR = '#c9b98f';
export const PLACE_COLOR = '#2ec4b6';
export const NEUTRAL = '#6b7489';
const MALE = '#62a8ff';
const FEMALE = '#ff7fb0';
const FRONTIER = '#ff5c5c';
const DETACHED = '#b184ff';
const KNOWN = '#8fa6c8';

function blend(colors: string[]): string {
  const c = new Color(0, 0, 0);
  for (const x of colors) c.add(new Color(x));
  c.multiplyScalar(1 / colors.length);
  return '#' + c.getHexString();
}

function fade(color: string, toward: string, amount: number): string {
  return '#' + new Color(color).lerp(new Color(toward), amount).getHexString();
}

function hashHue(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h * 0.618033988749895) % 1;
}

export function lineColor(s: Settings, i: number): string {
  return s.lineColors[i % s.lineColors.length];
}

export function personColor(ctx: Context, s: Settings, id: string): string {
  const ev = ctx.evidence.persons.get(id);
  const p = ctx.tree.persons.get(id);
  switch (s.colorBy) {
    case 'evidence':
      return EVIDENCE_COLORS[ev?.state ?? 'none'];
    case 'research':
      return ev?.detached ? DETACHED : ev?.frontier ? FRONTIER : KNOWN;
    case 'sex':
      return p?.sex === 'M' ? MALE : p?.sex === 'F' ? FEMALE : NEUTRAL;
    case 'generation': {
      const g = ctx.generations.get(id);
      if (g === undefined) return NEUTRAL;
      const c = new Color().setHSL(0.62 - Math.max(-4, Math.min(14, g)) * 0.045, 0.75, 0.6);
      return '#' + c.getHexString();
    }
    case 'surname': {
      const c = new Color().setHSL(hashHue(p?.surname || '?'), 0.7, 0.62);
      return '#' + c.getHexString();
    }
    default: {
      const info = ctx.lineInfo.get(id);
      if (!info) return NEUTRAL;
      let c = info.core ? CORE_COLOR : info.lines.length ? blend(info.lines.map((i) => lineColor(s, i))) : NEUTRAL;
      if (info.collateral) c = fade(c, s.background, s.collateralFade);
      return c;
    }
  }
}

export function nodeColor(ctx: Context, s: Settings, n: GNode): string {
  switch (n.kind) {
    case 'person':
      return personColor(ctx, s, n.ref);
    case 'union':
      return UNION_COLOR;
    case 'event': {
      const tag = n.ref.split(':')[1] as EventTag;
      return EVENT_COLORS[tag] ?? NEUTRAL;
    }
    case 'place':
      return PLACE_COLOR;
    case 'source': {
      let best = -1;
      for (const f of ctx.evidence.facts.values()) {
        for (const c of f.event.citations) if (c.sourceId === n.ref && c.quay !== undefined) best = Math.max(best, c.quay);
      }
      return best >= 0 ? QUAY_COLORS[best] : NEUTRAL;
    }
  }
}

export interface LegendEntry {
  color: string;
  label: string;
  count?: number;
}

export function legend(ctx: Context, s: Settings, shown: Set<string>): {title: string; entries: LegendEntry[]} {
  const count = (pred: (id: string) => boolean) => [...shown].filter(pred).length;
  switch (s.colorBy) {
    case 'evidence':
      return {
        title: t('legend.evidence'),
        entries: (['record', 'secondary', 'hint', 'unsourced', 'none'] as Bucket[]).map((b) => ({
          color: EVIDENCE_COLORS[b],
          label: evidenceLabel(b),
          count: count((id) => ctx.evidence.persons.get(id)?.state === b),
        })),
      };
    case 'research':
      return {
        title: t('legend.research'),
        entries: [
          {color: FRONTIER, label: t('legend.frontier'), count: count((id) => !!ctx.evidence.persons.get(id)?.frontier && !ctx.evidence.persons.get(id)?.detached)},
          {color: DETACHED, label: t('legend.detached'), count: count((id) => !!ctx.evidence.persons.get(id)?.detached)},
          {color: KNOWN, label: t('legend.known'), count: count((id) => !ctx.evidence.persons.get(id)?.frontier && !ctx.evidence.persons.get(id)?.detached)},
        ],
      };
    case 'sex':
      return {
        title: t('legend.sex'),
        entries: [
          {color: MALE, label: t('legend.male'), count: count((id) => ctx.tree.persons.get(id)?.sex === 'M')},
          {color: FEMALE, label: t('legend.female'), count: count((id) => ctx.tree.persons.get(id)?.sex === 'F')},
          {color: NEUTRAL, label: t('legend.unknown'), count: count((id) => !ctx.tree.persons.get(id)?.sex)},
        ],
      };
    case 'generation':
      return {
        title: t('legend.generation'),
        entries: [0, 2, 4, 6, 8, 10, 12].map((g) => ({
          color: '#' + new Color().setHSL(0.62 - g * 0.045, 0.75, 0.6).getHexString(),
          label: g === 0 ? t('legend.root') : t('legend.genN', {n: g}),
        })),
      };
    case 'surname':
      return {title: t('legend.surname'), entries: []};
    default:
      return {
        title: t('legend.line'),
        entries: [
          {color: CORE_COLOR, label: t('legend.core'), count: count((id) => !!ctx.lineInfo.get(id)?.core)},
          ...ctx.lines.map((l, i) => ({
            color: lineColor(s, i),
            label: l.label,
            count: count((id) => !!ctx.lineInfo.get(id)?.lines.includes(i)),
          })),
          {color: fade('#ffffff', s.background, s.collateralFade), label: t('legend.collateral')},
          {color: NEUTRAL, label: t('legend.noLine'), count: count((id) => {
            const i = ctx.lineInfo.get(id);
            return !i || (!i.core && !i.lines.length);
          })},
        ],
      };
  }
}
