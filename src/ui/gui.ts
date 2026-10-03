/**
 * The settings panel. Every control applies live; each is tagged with how much
 * of the scene it invalidates, from a restyle up to a new graph.
 */

import GUI, {Controller} from 'lil-gui';
import {eventLabel} from '../graph';
import {Key, t} from '../i18n';
import {EVENT_TAGS} from '../model';
import {
  DEFAULT_PRESET,
  DEFAULTS,
  Settings,
  allPresets,
  builtinPresets,
  deletePreset,
  diff,
  merge,
  savePreset,
  userPresets,
} from '../settings';

export type Impact = 'style' | 'objects' | 'repin' | 'layout' | 'graph' | 'grid' | 'cursor' | 'labels' | 'highlight';

export interface GuiHooks {
  changed(impact: Impact): void;
  /** A whole new settings object (a preset). */
  replace(s: Settings): void;
  lineLabels(): string[];
  resetAnchors(): void;
  overview(): void;
}

/** `{label: value}` for a dropdown, labels from `gui.<prefix>.<value>`. */
function options(prefix: string, values: string[]): Record<string, string> {
  return Object.fromEntries(values.map((v) => [t(`gui.${prefix}.${v}` as Key), v]));
}

/** Built-in presets show translated names; your own keep theirs. */
function presetOptions(): Record<string, string> {
  const builtin = builtinPresets();
  return Object.fromEntries(
    Object.keys(allPresets()).map((k) => [k in builtin && !(k in userPresets()) ? t(`preset.${k}` as Key) : k, k]),
  );
}

export class SettingsGui {
  readonly gui: GUI;
  private lineFolder!: GUI;
  private presetCtl!: Controller;
  private preset = {name: DEFAULT_PRESET};

  constructor(private s: Settings, private hooks: GuiHooks) {
    this.gui = new GUI({title: t('gui.title'), width: 300});
    this.gui.close();
    this.build();
  }

  private on(ctl: Controller, impact: Impact) {
    return ctl.onChange(() => this.hooks.changed(impact));
  }

  private build() {
    const s = this.s;
    const g = this.gui;

    const presets = g.addFolder(t('gui.presets'));
    this.presetCtl = presets.add(this.preset, 'name', presetOptions()).name(t('gui.preset'));
    const actions = {
      load: () => {
        const p = allPresets()[this.preset.name];
        if (p) this.hooks.replace(merge(DEFAULTS, p));
      },
      saveAs: () => {
        const name = prompt(t('gui.promptName'), this.preset.name === DEFAULT_PRESET ? '' : this.preset.name);
        if (!name) return;
        if (name in builtinPresets() && !(name in userPresets())) {
          if (!confirm(t('gui.confirmOverride', {name}))) return;
        }
        savePreset(name, s);
        this.preset.name = name;
        this.refreshPresetList();
      },
      remove: () => {
        if (!(this.preset.name in userPresets())) return alert(t('gui.builtinOnly'));
        deletePreset(this.preset.name);
        this.preset.name = DEFAULT_PRESET;
        this.refreshPresetList();
      },
      copy: async () => {
        const json = JSON.stringify({[this.preset.name]: diff(s)}, null, 2);
        try {
          await navigator.clipboard.writeText(json);
          alert(t('gui.copied'));
        } catch {
          prompt(t('gui.jsonPrompt'), json);
        }
      },
      reset: () => this.hooks.replace(merge(DEFAULTS, builtinPresets()[DEFAULT_PRESET])),
    };
    presets.add(actions, 'load').name(t('gui.load'));
    presets.add(actions, 'saveAs').name(t('gui.saveAs'));
    presets.add(actions, 'remove').name(t('gui.delete'));
    presets.add(actions, 'copy').name(t('gui.copyJson'));
    presets.add(actions, 'reset').name(t('gui.reset'));

    const filter = g.addFolder(t('gui.filter'));
    this.on(filter.add(s, 'scope', options('scope', ['all', 'lineage', 'ancestors', 'descendants'])).name(t('gui.scope')), 'graph');
    this.on(filter.add(s, 'generations', 0, 20, 1).name(t('gui.generations')), 'graph');
    this.on(filter.add(s, 'showDetached').name(t('gui.showDetached')), 'graph');
    this.on(filter.add(s, 'dimOpacity', 0, 1, 0.01).name(t('gui.dimOpacity')), 'highlight');

    const nodes = g.addFolder(t('gui.nodes'));
    this.on(nodes.add(s, 'showUnions').name(t('gui.showUnions')), 'graph');
    this.on(nodes.add(s, 'personShape', options('shape', ['sphere', 'lifeline'])).name(t('gui.personShape')), 'objects');
    this.on(nodes.add(s, 'photos').name(t('gui.photos')), 'objects');
    this.on(nodes.add(s, 'nodeSize', 0.5, 8, 0.1).name(t('gui.nodeSize')), 'objects');
    this.on(nodes.add(s, 'sizeBy', options('sizeBy', ['equal', 'descendants', 'sources'])).name(t('gui.sizeBy')), 'graph');
    this.on(nodes.add(s, 'lifelineWidth', 0.05, 2, 0.05).name(t('gui.lifelineWidth')), 'objects');
    const ev = nodes.addFolder(t('gui.eventNodes'));
    for (const tag of EVENT_TAGS) this.on(ev.add(s.events, tag).name(eventLabel(tag)), 'graph');
    ev.close();
    this.on(nodes.add(s, 'showPlaces').name(t('gui.showPlaces')), 'graph');
    this.on(nodes.add(s, 'showSources').name(t('gui.showSources')), 'graph');

    const colors = g.addFolder(t('gui.colors'));
    this.on(
      colors.add(s, 'colorBy', options('colorBy', ['line', 'evidence', 'research', 'sex', 'generation', 'surname'])).name(t('gui.colorBy')),
      'objects',
    );
    this.on(colors.addColor(s, 'background').name(t('gui.background')), 'style');
    this.on(colors.add(s, 'glow', 0, 2, 0.05).name(t('gui.glow')), 'objects');
    this.on(colors.add(s, 'collateralFade', 0, 0.9, 0.05).name(t('gui.collateralFade')), 'objects');
    this.lineFolder = colors.addFolder(t('gui.lineColors'));
    this.buildLineColors();
    this.lineFolder.add({reset: () => this.hooks.resetAnchors()}, 'reset').name(t('gui.resetAnchors'));
    this.lineFolder.close();

    const links = g.addFolder(t('gui.links'));
    this.on(links.add(s, 'linkOpacity', 0, 1, 0.01).name(t('gui.linkOpacity')), 'style');
    this.on(links.add(s, 'linkWidth', 0, 3, 0.1).name(t('gui.linkWidth')), 'style');
    this.on(links.add(s, 'linkCurvature', 0, 1, 0.01).name(t('gui.linkCurvature')), 'style');
    this.on(links.add(s, 'linkColorMode', options('linkColorMode', ['node', 'single'])).name(t('gui.linkColorMode')), 'style');
    this.on(links.addColor(s, 'linkColor').name(t('gui.linkColor')), 'style');
    this.on(links.add(s, 'particles').name(t('gui.particles')), 'style');
    this.on(links.add(s, 'particleSpeed', 0.001, 0.03, 0.001).name(t('gui.particleSpeed')), 'style');
    this.on(links.add(s, 'particleWidth', 0.2, 4, 0.1).name(t('gui.particleWidth')), 'style');
    links.close();

    const time = g.addFolder(t('gui.time'));
    this.on(time.add(s, 'axis', options('axis', ['vertical', 'depth'])).name(t('gui.axis')), 'repin');
    this.on(time.add(s, 'timeFlow', options('timeFlow', ['up', 'down'])).name(t('gui.timeFlow')), 'repin');
    this.on(time.add(s, 'timeMode', options('timeMode', ['year', 'generation'])).name(t('gui.timeMode')), 'repin');
    this.on(time.add(s, 'yearScale', 0.3, 8, 0.1).name(t('gui.yearScale')), 'repin');
    this.on(time.add(s, 'generationSpacing', 10, 200, 1).name(t('gui.generationSpacing')), 'repin');
    this.on(time.add(s, 'grid').name(t('gui.grid')), 'grid');
    this.on(time.add(s, 'decades').name(t('gui.decades')), 'grid');
    this.on(time.add(s, 'gridRadius', 40, 800, 5).name(t('gui.gridRadius')), 'grid');
    this.on(time.add(s, 'gridOpacity', 0, 1, 0.01).name(t('gui.gridOpacity')), 'grid');
    this.on(time.add(s, 'cursor').name(t('gui.cursor')), 'cursor');
    this.on(time.add(s, 'cursorYear', 1500, 2030, 1).name(t('gui.cursorYear')), 'cursor');
    this.on(time.add(s, 'cursorFollow').name(t('gui.cursorFollow')), 'cursor');

    const layout = g.addFolder(t('gui.layout'));
    this.on(layout.add(s, 'charge', -300, 0, 1).name(t('gui.charge')), 'layout');
    this.on(layout.add(s, 'linkDistance', 2, 120, 1).name(t('gui.linkDistance')), 'layout');
    this.on(layout.add(s, 'lineSeparation', 0, 0.3, 0.005).name(t('gui.lineSeparation')), 'layout');
    this.on(layout.add(s, 'lineRadius', 0, 500, 5).name(t('gui.lineRadius')), 'layout');
    this.on(layout.add(s, 'velocityDecay', 0.05, 0.9, 0.01).name(t('gui.velocityDecay')), 'layout');
    layout.add({go: () => this.hooks.changed('layout')}, 'go').name(t('gui.relayout'));
    layout.add({go: () => this.hooks.overview()}, 'go').name(t('gui.overview'));
    layout.close();

    const fx = g.addFolder(t('gui.effects'));
    this.on(fx.add(s, 'bloom').name(t('gui.bloom')), 'style');
    this.on(fx.add(s, 'bloomStrength', 0, 3, 0.05).name(t('gui.bloomStrength')), 'style');
    this.on(fx.add(s, 'bloomRadius', 0, 1.5, 0.01).name(t('gui.bloomRadius')), 'style');
    this.on(fx.add(s, 'bloomThreshold', 0, 1, 0.01).name(t('gui.bloomThreshold')), 'style');
    this.on(fx.add(s, 'fog').name(t('gui.fog')), 'style');
    this.on(fx.add(s, 'fogDensity', 0, 0.002, 0.00005).name(t('gui.fogDensity')), 'style');
    fx.close();

    const labels = g.addFolder(t('gui.labels'));
    this.on(labels.add(s, 'labels', options('labelMode', ['off', 'selection', 'near', 'all'])).name(t('gui.labelMode')), 'labels');
    this.on(labels.add(s, 'pointerRadius', 0, 300, 5).name(t('gui.pointerRadius')), 'labels');
    this.on(labels.add(s, 'pointerMax', 1, 80, 1).name(t('gui.pointerMax')), 'labels');
    this.on(labels.add(s, 'labelSize', 8, 24, 1).name(t('gui.labelSize')), 'style');
    this.on(labels.add(s, 'labelDistance', 40, 800, 10).name(t('gui.labelDistance')), 'labels');
    labels.close();

    // Only the title bar shows at first; the folders open on demand.
    for (const f of [presets, filter, nodes, colors, time]) f.close();
  }

  buildLineColors() {
    for (const c of [...this.lineFolder.controllers]) if (c.property !== 'reset') c.destroy();
    const labels = this.hooks.lineLabels();
    while (this.s.lineColors.length < labels.length) this.s.lineColors.push(DEFAULTS.lineColors[this.s.lineColors.length % DEFAULTS.lineColors.length]);
    labels.forEach((label, i) => {
      this.on(this.lineFolder.addColor(this.s.lineColors, i).name(label), 'objects');
    });
  }

  private refreshPresetList() {
    this.presetCtl.options(presetOptions());
    this.presetCtl.setValue(this.preset.name);
  }

  /** Point the controls at a new settings object (after a preset load). */
  rebind(s: Settings) {
    // In place: the controllers hold references to `events` and `lineColors`.
    const {events, lineColors, ...rest} = s;
    Object.assign(this.s, rest);
    Object.assign(this.s.events, events);
    this.s.lineColors.splice(0, this.s.lineColors.length, ...lineColors);
    this.buildLineColors();
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }
}
