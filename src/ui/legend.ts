/**
 * The legend: what the colours mean, how many of the shown persons carry each,
 * and — for the evidence and research schemes — the tree-wide counts, which an
 * external classifier can be held to (test/crosscheck.spec.ts).
 */

import {legend} from '../colors';
import {Context, GraphData} from '../graph';
import {t} from '../i18n';
import {Settings} from '../settings';

export function renderLegend(el: HTMLElement, ctx: Context, s: Settings, data: GraphData) {
  const shown = new Set(data.nodes.filter((n) => n.kind === 'person').map((n) => n.ref));
  const {title, entries} = legend(ctx, s, shown);
  const {summary, queues} = ctx.evidence;
  let footer = '';
  if (s.colorBy === 'evidence') {
    footer = `<div class="foot">${t('legend.facts', {...summary})}</div>`;
  } else if (s.colorBy === 'research') {
    footer = `<div class="foot">${t('legend.queues', {...queues})}</div>`;
  }
  const counts = {
    person: shown.size,
    union: data.nodes.filter((n) => n.kind === 'union').length,
    event: data.nodes.filter((n) => n.kind === 'event').length,
    place: data.nodes.filter((n) => n.kind === 'place').length,
    source: data.nodes.filter((n) => n.kind === 'source').length,
  };
  const parts = [t('legend.persons', {n: counts.person})];
  if (counts.union) parts.push(t('legend.families', {n: counts.union}));
  if (counts.event) parts.push(t('legend.events', {n: counts.event}));
  if (data.undatedEvents) parts.push(t('legend.undatedEvents', {n: data.undatedEvents}));
  if (counts.place) parts.push(t('legend.places', {n: counts.place}));
  if (counts.source) parts.push(t('legend.sources', {n: counts.source}));

  el.innerHTML = `
    <h4>${title}</h4>
    <ul>${entries
      .map((e) => `<li><span class="swatch" style="background:${e.color}"></span>${e.label}${e.count !== undefined ? ` <span class="muted">${e.count}</span>` : ''}</li>`)
      .join('')}</ul>
    ${footer}
    <div class="foot">${parts.join(' · ')}</div>
    <div class="foot muted">${t('legend.hollow')}</div>`;
}
