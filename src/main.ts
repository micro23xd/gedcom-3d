/**
 * gedcom-3d — entry point. Reads `?ged=` (same origin only, never a remote
 * URL) and `?root=`, builds the model, and wires scene and UI. Any GEDCOM can
 * also be opened from disk or dropped on the page; the browser reads it
 * locally and it replaces the tree in place.
 */

import './style.css';
import {computeEvidence} from './evidence';
import {Context, GNode, GraphData, buildGraph} from './graph';
import {t, translateDocument} from './i18n';
import {computeLines, deepestPedigree, defaultAnchors} from './lines';
import {decodeGedcom} from './gedcom/decode';
import {Tree, buildTree} from './model';
import {Settings, loadState, saveState} from './settings';
import {computeGenerations, computeTimes} from './timeline';
import {View} from './scene/view';
import {Impact, SettingsGui} from './ui/gui';
import {renderLegend} from './ui/legend';
import {Panel} from './ui/panel';
import {installOpen, toast} from './ui/open';
import {installSearch} from './ui/search';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

/** A loaded file: the tree and where it came from. */
interface Source {
  tree: Tree;
  /** Shown in the top bar. */
  name: string;
  /** Keys what is remembered per file: anchors, positions, camera. */
  key: string;
  /** Loaded from the page's own `?ged=`, so `root=` in the URL belongs to it. */
  fromUrl: boolean;
  root?: string;
}

function anchorKey(source: string, root: string) {
  return `gedcom3d:anchors:${source}:${root}`;
}

function storedAnchors(source: string, root: string): string[] | undefined {
  try {
    const raw = localStorage.getItem(anchorKey(source, root));
    return raw ? (JSON.parse(raw) as string[]) : undefined;
  } catch {
    return undefined;
  }
}

function storeAnchors(source: string, root: string, anchors: string[] | undefined) {
  try {
    if (anchors) localStorage.setItem(anchorKey(source, root), JSON.stringify(anchors));
    else localStorage.removeItem(anchorKey(source, root));
  } catch {
    // not persisted
  }
}

function makeContext(
  tree: Tree,
  root: string,
  source: string,
  evidence = computeEvidence(tree, {seed: root}),
  times = computeTimes(tree),
): Context {
  const anchors = (storedAnchors(source, root) ?? defaultAnchors(tree, root)).filter((a) => tree.persons.has(a));
  const {lines, info} = computeLines(tree, root, anchors);
  return {tree, evidence, times, generations: computeGenerations(tree, root), lines, lineInfo: info, root};
}

/** The URL's root=, else the person with the deepest pedigree. */
function pickRoot(tree: Tree, wanted?: string): string {
  if (wanted && tree.persons.has(wanted)) return wanted;
  return deepestPedigree(tree) ?? tree.persons.keys().next().value ?? '';
}

/** The file to show at start: `?ged=`, else the build's default (the demo on Pages), else none. */
function initialGed(params: URLSearchParams): string | undefined {
  return params.get('ged') ?? (import.meta.env.VITE_DEFAULT_GED || undefined);
}

async function fromUrl(gedPath: string, params: URLSearchParams): Promise<Source> {
  const gedUrl = new URL(gedPath, location.href);
  if (gedUrl.origin !== location.origin) throw new Error(t('app.sameOrigin'));
  const res = await fetch(gedUrl, {cache: 'no-store'});
  if (!res.ok) throw new Error(`${gedUrl.pathname}: HTTP ${res.status}`);
  const {text, warning} = decodeGedcom(await res.arrayBuffer());
  if (warning) toast(warning);
  return {
    tree: buildTree(text, gedUrl.href),
    name: decodeURIComponent(gedUrl.pathname.split('/').pop() ?? gedPath),
    key: `url:${gedUrl.pathname}`,
    fromUrl: true,
    root: params.get('root') ?? undefined,
  };
}

async function fromFile(file: File): Promise<Source | undefined> {
  const {text, warning} = decodeGedcom(await file.arrayBuffer());
  // Media paths resolve as if the file sat in data/ on this server: a file
  // whose media live in ../media/ next to it still finds them, and nothing
  // is ever fetched from another host.
  const tree = buildTree(text, new URL(`/data/${encodeURIComponent(file.name)}`, location.href).href);
  if (!/^\s*0\s+HEAD\b/m.test(text.slice(0, 2000)) || !tree.persons.size) {
    toast(t('app.notGedcom', {name: file.name}), 'error');
    return undefined;
  }
  if (warning) toast(warning);
  return {tree, name: file.name, key: `file:${file.name}:${file.size}:${file.lastModified}`, fromUrl: false};
}

interface App {
  replace(src: Source): void;
}

function createApp(src: Source): App {
  const params = new URLSearchParams(location.search);
  let tree = src.tree;
  let source = src;
  let root = pickRoot(tree, src.root);

  let ctx = makeContext(tree, root, source.key);
  const s: Settings = loadState();
  let data: GraphData;

  const view = new View($('#scene'), ctx, s, {
    onSelect: (n) => select(n, false),
    onHover: () => {},
  });
  view.setSource(source.key);

  function selectPerson(id: string) {
    const n = view.findPerson(id);
    if (n) select(n, true);
    else {
      // Outside the current filter: show the panel anyway.
      view.select(null);
      document.body.classList.add('panel-open');
      panel.show({id: `p:${id}`, kind: 'person', ref: id, label: tree.persons.get(id)?.name ?? id, estimated: false, weight: 1});
    }
  }

  const panel = new Panel($('#panel'), ctx, {
    selectPerson,
    setRoot: (id) => setRoot(id),
    toggleAnchor: (id) => {
      const current = ctx.lines.map((l) => l.anchor);
      const next = current.includes(id) ? current.filter((a) => a !== id) : [...current, id];
      storeAnchors(source.key, root, next);
      recontext();
    },
    isAnchor: (id) => ctx.lines.some((l) => l.anchor === id),
    close: () => select(null, false),
  });

  function select(n: GNode | null, fly: boolean) {
    view.select(n);
    panel.show(n);
    document.body.classList.toggle('panel-open', !!n);
    view.updateLabels();
    if (n && fly) view.flyTo(n);
  }

  function rebuildGraph() {
    data = buildGraph(ctx, s);
    view.setData(data);
    renderLegend($('#legend'), ctx, s, data);
    updateTimebar();
  }

  function recontext() {
    ctx = makeContext(tree, root, source.key, ctx.evidence, ctx.times);
    view.ctx = ctx;
    panel.setContext(ctx);
    gui.buildLineColors();
    rebuildGraph();
    view.rebuildObjects();
  }

  function setRoot(id: string) {
    root = id;
    // The URL's root= names a person of the URL's file, not of a dropped one.
    if (source.fromUrl) {
      params.set('root', id);
      history.replaceState(null, '', `${location.pathname}?${params}`);
    }
    recontext();
  }

  function showSourceName() {
    $('#source').textContent = source.name;
    $('#source').title = source.fromUrl ? source.name : t('app.fromFile', {name: source.name});
  }

  const gui = new SettingsGui(s, {
    changed: (impact: Impact) => {
      apply(impact);
      saveState(s);
    },
    replace: (next) => {
      gui.rebind(next);
      saveState(s);
      view.applyStyle(s);
      rebuildGraph();
      view.repin();
      view.setCursor();
    },
    lineLabels: () => ctx.lines.map((l) => l.label),
    resetAnchors: () => {
      storeAnchors(source.key, root, undefined);
      recontext();
    },
    overview: () => view.overview(),
  });

  function apply(impact: Impact) {
    switch (impact) {
      case 'style':
        view.applyStyle(s);
        break;
      case 'objects':
        view.applyStyle(s);
        view.rebuildObjects();
        renderLegend($('#legend'), ctx, s, data);
        break;
      case 'repin':
        view.repin();
        updateTimebar();
        break;
      case 'layout':
        view.relayout();
        break;
      case 'graph':
        rebuildGraph();
        break;
      case 'grid':
      case 'cursor':
        view.setCursor();
        updateTimebar();
        break;
      case 'labels':
        view.updateLabels();
        break;
      case 'highlight':
        view.refreshHighlight();
        break;
    }
  }

  // --- time bar -------------------------------------------------------------------
  const slider = $<HTMLInputElement>('#year');
  const yearOut = $('#year-out');
  const cursorBox = $<HTMLInputElement>('#cursor');
  function updateTimebar() {
    const years = data.nodes.map((n) => n.year).filter((y): y is number => y !== undefined);
    slider.min = String(Math.floor(Math.min(...years) / 10) * 10);
    slider.max = String(Math.ceil(Math.max(...years) / 10) * 10);
    slider.value = String(s.cursorYear);
    yearOut.textContent = String(s.cursorYear);
    cursorBox.checked = s.cursor;
    $('#timebar').classList.toggle('disabled', s.timeMode !== 'year');
    gui.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }
  slider.addEventListener('input', () => {
    s.cursorYear = Number(slider.value);
    yearOut.textContent = slider.value;
    view.travelTo(s.cursorYear);
    if (s.cursor) view.setCursor();
    saveState(s);
    gui.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  });
  cursorBox.addEventListener('change', () => {
    s.cursor = cursorBox.checked;
    view.setCursor();
    saveState(s);
    gui.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  });

  // --- search and keys --------------------------------------------------------------
  installSearch($<HTMLInputElement>('#search'), $('#results'), () => tree, selectPerson);
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    const step = e.shiftKey ? 60 : 20;
    if (e.key === 'Escape') select(null, false);
    else if (e.key === '/') {
      e.preventDefault();
      $<HTMLInputElement>('#search').focus();
    } else if (e.key === 'f' || e.key === 'F') view.overview();
    else if (e.key === 'ArrowUp' || e.key === 'PageUp') view.travel(step);
    else if (e.key === 'ArrowDown' || e.key === 'PageDown') view.travel(-step);
    else return;
    e.preventDefault();
  });
  $('#help-toggle').addEventListener('click', () => $('#help').classList.toggle('open'));

  // A handle for poking at the running viewer from the browser console.
  (window as unknown as {__gedcom3d: unknown}).__gedcom3d = {view, settings: s, gui: gui.gui};
  view.applyStyle(s);
  rebuildGraph();
  view.setCursor();
  showSourceName();
  if (!view.restoreCamera()) settleOverview();

  function settleOverview() {
    view.overview(0);
    setTimeout(() => view.overview(1200), 2500);
  }

  return {
    replace(next: Source) {
      select(null, false);
      tree = next.tree;
      source = next;
      root = pickRoot(tree, next.root);
      view.forget();
      view.setSource(source.key);
      ctx = makeContext(tree, root, source.key);
      view.ctx = ctx;
      panel.setContext(ctx);
      gui.buildLineColors();
      rebuildGraph();
      view.rebuildObjects();
      showSourceName();
      if (!view.restoreCamera()) settleOverview();
    },
  };
}

async function main() {
  translateDocument();
  const loading = $('#loading');
  let app: App | undefined;
  const show = (src: Source) => {
    if (app) app.replace(src);
    else app = createApp(src);
    loading.hidden = true;
    toast(t('app.loaded', {name: src.name, persons: src.tree.persons.size, families: src.tree.families.size}));
  };

  installOpen(async (file) => {
    try {
      const src = await fromFile(file);
      if (src) show(src);
    } catch (err) {
      toast(t('app.readFailed', {name: file.name, reason: (err as Error).message}), 'error');
      console.error(err);
    }
  });

  const params = new URLSearchParams(location.search);
  const ged = initialGed(params);
  if (!ged) {
    loading.classList.add('empty');
    $('#loading .why').textContent = '';
    return;
  }
  try {
    const src = await fromUrl(ged, params);
    if (!src.tree.persons.size) throw new Error(t('app.noPersons', {name: src.name}));
    app = createApp(src);
    loading.hidden = true;
  } catch (err) {
    // No tree from the server (a wrong ?ged=, or no server at all): offer to
    // open one from disk instead.
    loading.classList.add('empty');
    $('#loading .why').textContent = t('app.noTree', {reason: (err as Error).message});
    console.error(err);
  }
}

main();
