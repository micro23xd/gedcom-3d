/**
 * The detail panel. Compact by default — portrait, name, the life in one or
 * two lines, and the nearest family as chips — with everything else (all
 * events, their citations and QUAY, notes, media, research state) behind
 * "show more".
 */

import {EVIDENCE_COLORS, QUAY_COLORS, evidenceLabel} from '../colors';
import {Context, GNode, eventLabel, placeKey} from '../graph';
import {t} from '../i18n';
import {GEvent, Person, childrenOf, parentsOf, partnersOf, siblingsOf, spousesOf} from '../model';

export interface PanelActions {
  selectPerson(id: string): void;
  setRoot(id: string): void;
  toggleAnchor(id: string): void;
  isAnchor(id: string): boolean;
  close(): void;
}

const esc = (x: string) =>
  x.replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c] as string);

export function placeText(place: string): string {
  return place.split(',').map((p) => p.trim()).filter(Boolean).join(', ');
}

export class Panel {
  private expanded = false;
  private current: GNode | null = null;

  constructor(private el: HTMLElement, private ctx: Context, private actions: PanelActions) {
    el.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-person],[data-action]') as HTMLElement | null;
      if (!el) return;
      if (el.dataset.person) this.actions.selectPerson(el.dataset.person);
      const a = el.dataset.action;
      if (a === 'more') {
        this.expanded = !this.expanded;
        this.render();
      } else if (a === 'close') this.actions.close();
      else if (a === 'root' && el.dataset.id) this.actions.setRoot(el.dataset.id);
      else if (a === 'anchor' && el.dataset.id) {
        this.actions.toggleAnchor(el.dataset.id);
        this.render();
      }
    });
  }

  setContext(ctx: Context) {
    this.ctx = ctx;
    this.render();
  }

  show(n: GNode | null) {
    this.current = n;
    this.render();
  }

  private render() {
    const n = this.current;
    this.el.classList.toggle('open', !!n);
    if (!n) {
      this.el.innerHTML = '';
      return;
    }
    let html = '';
    if (n.kind === 'person') html = this.person(n.ref);
    else if (n.kind === 'event' && n.owner) {
      html = this.ctx.tree.persons.has(n.owner) ? this.person(n.owner, n.ref) : this.family(n.owner, n.ref);
    } else if (n.kind === 'union') html = this.family(n.ref);
    else if (n.kind === 'place') html = this.place(n.ref);
    else if (n.kind === 'source') html = this.source(n.ref);
    this.el.innerHTML = `<button class="close" data-action="close" title="${t('panel.close')}">×</button>${html}`;
    this.el.querySelector('.ev.focus')?.scrollIntoView({block: 'center'});
  }

  // --- pieces --------------------------------------------------------------------

  private chip(id: string, extra = ''): string {
    const p = this.ctx.tree.persons.get(id);
    if (!p) return '';
    const tm = this.ctx.times.persons.get(id);
    const b = p.events.find((e) => (e.tag === 'BIRT' || e.tag === 'CHR') && e.date)?.date?.year;
    const years = b ? ` <span class="muted">${b}</span>` : tm?.year ? ` <span class="muted">≈${tm.year}</span>` : '';
    return `<button class="chip" data-person="${esc(id)}">${esc(p.name)}${years}${extra}</button>`;
  }

  private chips(title: string, ids: string[], extra?: (id: string) => string): string {
    const uniq = [...new Set(ids)];
    if (!uniq.length) return '';
    return `<div class="rel"><h4>${title}</h4><div class="chips">${uniq.map((i) => this.chip(i, extra?.(i))).join('')}</div></div>`;
  }

  private dot(ev: GEvent): string {
    const f = this.ctx.evidence.facts.get(ev.id);
    if (!f) return '';
    return `<span class="dot" style="background:${EVIDENCE_COLORS[f.bucket]}" title="${evidenceLabel(f.bucket)}"></span>`;
  }

  private lifeLine(symbol: string, ev: GEvent | undefined): string {
    if (!ev || (!ev.date && !ev.place)) return '';
    const parts = [ev.date?.display ?? ev.dateRaw, ev.place ? placeText(ev.place) : undefined].filter(Boolean) as string[];
    return `<div class="life">${this.dot(ev)}<span class="sym">${symbol}</span> ${esc(parts.join(', '))}</div>`;
  }

  private eventTitle(ev: GEvent): string {
    const base = ev.tag === 'EVEN' ? ev.type ?? eventLabel('EVEN') : eventLabel(ev.tag);
    return ev.value && ev.tag !== 'EVEN' ? `${base}: ${ev.value}` : base;
  }

  private eventRow(ev: GEvent, focus: boolean): string {
    const when = ev.date?.display ?? ev.dateRaw ?? '';
    const where = ev.place ? placeText(ev.place) : '';
    const cites = ev.citations
      .map((c) => {
        const src = this.ctx.tree.sources.get(c.sourceId);
        const q = c.quay !== undefined ? `<span class="quay" style="border-color:${QUAY_COLORS[c.quay] ?? '#888'};color:${QUAY_COLORS[c.quay] ?? '#888'}">QUAY ${c.quay}</span>` : `<span class="quay">${t('panel.noQuay')}</span>`;
        return `<li>${q} ${esc(src?.title ?? c.sourceId)}${c.page ? `<div class="page">${esc(c.page)}</div>` : ''}${c.note ? `<div class="page">${esc(c.note)}</div>` : ''}</li>`;
      })
      .join('');
    const media = ev.media.map((m) => this.mediaThumb(m)).join('');
    return `<div class="ev${focus ? ' focus' : ''}">
      <div class="ev-head">${this.dot(ev)}<b>${esc(this.eventTitle(ev))}</b>${when ? ` <span>${esc(when)}</span>` : ''}</div>
      ${where ? `<div class="muted">${esc(where)}</div>` : ''}
      ${ev.cause ? `<div class="muted">${esc(t('panel.cause', {cause: ev.cause}))}</div>` : ''}
      ${ev.note ? `<div class="note">${esc(ev.note)}</div>` : ''}
      ${cites ? `<ul class="cites">${cites}</ul>` : `<div class="muted small">${t('panel.noSource')}</div>`}
      ${media ? `<div class="gallery">${media}</div>` : ''}
    </div>`;
  }

  private mediaThumb(id: string): string {
    const m = this.ctx.tree.media.get(id);
    if (!m?.url) return '';
    const img = /\.(jpe?g|png|webp|gif)$/i.test(m.url);
    const title = esc(m.title ?? '');
    return `<a class="thumb" href="${esc(m.url)}" target="_blank" rel="noopener" title="${title}">${
      img ? `<img src="${esc(m.url)}" alt="${title}" loading="lazy">` : `<span>${esc(m.form ?? t('panel.file'))}</span>`
    }</a>`;
  }

  private sortedEvents(evs: GEvent[]): GEvent[] {
    return [...evs].sort((a, b) => (a.date?.sort ?? 9999) - (b.date?.sort ?? 9999));
  }

  // --- views -----------------------------------------------------------------------

  private person(id: string, focusEvent?: string): string {
    const {tree, evidence, times} = this.ctx;
    const p = tree.persons.get(id) as Person;
    if (!p) return '';
    const ev = evidence.persons.get(id);
    const tm = times.persons.get(id);
    const birth = p.events.find((e) => e.tag === 'BIRT' && (e.date || e.place));
    const chr = p.events.find((e) => e.tag === 'CHR' && (e.date || e.place));
    const death = p.events.find((e) => e.tag === 'DEAT' && (e.date || e.place));
    const buri = p.events.find((e) => e.tag === 'BURI' && (e.date || e.place));
    const occu = p.events.find((e) => e.tag === 'OCCU' && e.value);
    const photo = p.media.map((m) => tree.media.get(m)).find((m) => m?.url && /\.(jpe?g|png|webp)$/i.test(m.url));

    const marriages = (spouse: string) => {
      const fam = p.fams.map((f) => tree.families.get(f)).find((f) => f && spousesOf(f).includes(spouse));
      const y = fam?.events.find((e) => e.tag === 'MARR' && e.date)?.date?.year;
      return y ? ` <span class="muted">⚭ ${y}</span>` : '';
    };

    const flags: string[] = [];
    if (tm?.source === 'none') {
      flags.push(`<div class="flag">${esc(t('panel.undated'))}</div>`);
    } else if (tm?.source && tm.source !== 'date') {
      const from = t(tm.source === 'event' ? 'panel.fromEvents' : 'panel.fromRelatives');
      flags.push(`<div class="flag">${esc(t('panel.estimated', {from, year: tm.year ?? '?'}))}</div>`);
    }

    let html = `
      ${photo ? `<a href="${esc(photo.url)}" target="_blank" rel="noopener"><img class="portrait" src="${esc(photo.url)}" alt=""></a>` : ''}
      <h2>${esc(p.name)}</h2>
      ${p.otherNames.length ? `<div class="muted">${esc(p.otherNames.join(' · '))}</div>` : ''}
      ${occu ? `<div class="muted">${esc(occu.value as string)}</div>` : ''}
      <div class="lifes">
        ${this.lifeLine('*', birth)}${birth ? '' : this.lifeLine('~', chr)}
        ${this.lifeLine('†', death)}${death ? '' : this.lifeLine('▭', buri)}
      </div>
      ${flags.join('')}
      ${this.chips(t('panel.parents'), parentsOf(tree, id))}
      ${this.chips(t('panel.spouses'), partnersOf(tree, id), marriages)}
      ${this.chips(t('panel.children'), childrenOf(tree, id))}
      <button class="more" data-action="more">${this.expanded ? t('panel.less') : t('panel.more')}</button>`;

    if (this.expanded || focusEvent) {
      const famEvents = p.fams.flatMap((f) => tree.families.get(f)?.events ?? []);
      const events = this.sortedEvents([...p.events, ...famEvents]);
      const media = p.media.map((m) => this.mediaThumb(m)).join('');
      const state = ev ? evidenceLabel(ev.state) : '';
      html += `
        <section>
          <h3>${t('panel.events')}</h3>
          ${events.map((e) => this.eventRow(e, e.id === focusEvent)).join('') || `<div class="muted">${t('panel.none')}</div>`}
        </section>
        ${this.chips(t('panel.siblings'), siblingsOf(tree, id))}
        ${p.notes.length ? `<section><h3>${t('panel.notes')}</h3>${p.notes.map((x) => `<div class="note">${esc(x)}</div>`).join('')}</section>` : ''}
        ${media ? `<section><h3>${t('panel.media')}</h3><div class="gallery">${media}</div></section>` : ''}
        <section class="research">
          <h3>${t('panel.research')}</h3>
          <div>${t('panel.weakest')} <span class="dot" style="background:${EVIDENCE_COLORS[ev?.state ?? 'none']}"></span> ${state}</div>
          ${ev?.frontier ? `<div>${t('panel.frontier')}</div>` : ''}
          ${ev?.detached ? `<div>${t('panel.detached')}</div>` : ''}
          ${p.famc.some((f) => f.pedi && f.pedi !== 'birth') ? `<div>${esc(t('panel.pedigree', {pedi: p.famc.map((f) => f.pedi ?? 'birth').join(', ')}))}</div>` : ''}
          ${p.refns.length ? `<div class="muted">REFN ${esc(p.refns.join(', '))}</div>` : ''}
          <div class="muted mono">${esc(id)}</div>
          <div class="actions">
            <button data-action="root" data-id="${esc(id)}">${t('panel.setRoot')}</button>
            <button data-action="anchor" data-id="${esc(id)}">${this.actions.isAnchor(id) ? t('panel.removeAnchor') : t('panel.addAnchor')}</button>
          </div>
        </section>`;
    }
    return html;
  }

  private family(famId: string, focusEvent?: string): string {
    const {tree} = this.ctx;
    const fam = tree.families.get(famId);
    if (!fam) return '';
    const names = spousesOf(fam).map((x) => tree.persons.get(x)?.name ?? '?').join(' & ');
    return `
      <div class="kind">${t('panel.family')}</div>
      <h2>⚭ ${esc(names || t('panel.unknownParents'))}</h2>
      ${this.chips(t('panel.partners'), spousesOf(fam))}
      ${this.chips(t('panel.children'), fam.children)}
      <section><h3>${t('panel.events')}</h3>${this.sortedEvents(fam.events).map((e) => this.eventRow(e, e.id === focusEvent)).join('') || `<div class="muted">${t('panel.none')}</div>`}</section>
      ${fam.notes.length ? `<section><h3>${t('panel.notes')}</h3>${fam.notes.map((x) => `<div class="note">${esc(x)}</div>`).join('')}</section>` : ''}
      <div class="muted mono">${esc(famId)}</div>`;
  }

  private place(key: string): string {
    const {tree} = this.ctx;
    const rows: {who: string; ev: GEvent}[] = [];
    const full = new Set<string>();
    for (const p of tree.persons.values()) {
      for (const e of p.events) if (e.place && placeKey(e.place) === key) (rows.push({who: p.id, ev: e}), full.add(placeText(e.place)));
    }
    for (const f of tree.families.values()) {
      for (const e of f.events) {
        if (e.place && placeKey(e.place) === key) {
          if (f.husb) rows.push({who: f.husb, ev: e});
          full.add(placeText(e.place));
        }
      }
    }
    rows.sort((a, b) => (a.ev.date?.sort ?? 9999) - (b.ev.date?.sort ?? 9999));
    const shown = this.expanded ? rows : rows.slice(0, 12);
    return `
      <div class="kind">${t('panel.place')}</div>
      <h2>${esc(key)}</h2>
      <div class="muted">${esc([...full].join(' · '))}</div>
      <div class="muted">${t('panel.placeEvents', {n: rows.length})}</div>
      <ul class="list">${shown
        .map((r) => `<li>${this.chip(r.who)} <span class="muted">${esc(this.eventTitle(r.ev))}${r.ev.date ? ' ' + esc(r.ev.date.display) : ''}</span></li>`)
        .join('')}</ul>
      ${rows.length > 12 ? `<button class="more" data-action="more">${this.expanded ? t('panel.less') : t('panel.all', {n: rows.length})}</button>` : ''}`;
  }

  private source(id: string): string {
    const {tree} = this.ctx;
    const src = tree.sources.get(id);
    if (!src) return '';
    const rows: {who: string; ev: GEvent; page?: string; quay?: number}[] = [];
    for (const p of tree.persons.values()) {
      for (const e of p.events) for (const c of e.citations) if (c.sourceId === id) rows.push({who: p.id, ev: e, page: c.page, quay: c.quay});
    }
    for (const f of tree.families.values()) {
      for (const e of f.events) for (const c of e.citations) if (c.sourceId === id && f.husb) rows.push({who: f.husb, ev: e, page: c.page, quay: c.quay});
    }
    const shown = this.expanded ? rows : rows.slice(0, 10);
    return `
      <div class="kind">${t('panel.source')}</div>
      <h2>${esc(src.title)}</h2>
      ${src.author ? `<div class="muted">${esc(src.author)}</div>` : ''}
      <div class="muted">${t('panel.citations', {n: rows.length})}</div>
      ${this.expanded && src.note ? `<div class="note">${esc(src.note)}</div>` : ''}
      <ul class="list">${shown
        .map((r) => `<li>${this.chip(r.who)} <span class="muted">${esc(this.eventTitle(r.ev))}${r.ev.date ? ' ' + esc(r.ev.date.display) : ''}${r.quay !== undefined ? ` · QUAY ${r.quay}` : ''}</span>${this.expanded && r.page ? `<div class="page">${esc(r.page)}</div>` : ''}</li>`)
        .join('')}</ul>
      <button class="more" data-action="more">${this.expanded ? t('panel.less') : t('panel.more')}</button>
      <div class="muted mono">${esc(id)}</div>`;
  }
}
