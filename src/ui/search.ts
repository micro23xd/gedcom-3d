/**
 * Name search: folds umlauts and accents, matches every typed token against
 * names, other names, years and the xref.
 */

import {Tree} from '../model';

export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function searchPersons(tree: Tree, query: string, limit = 12): string[] {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const hits: [number, string][] = [];
  for (const p of tree.persons.values()) {
    const years = p.events.map((e) => e.date?.year).filter(Boolean).join(' ');
    const hay = fold(`${p.name} ${p.otherNames.join(' ')} ${years} ${p.id}`);
    if (tokens.every((t) => hay.includes(t))) {
      const score = fold(p.name).startsWith(tokens[0]) ? 0 : 1;
      hits.push([score, p.id]);
    }
  }
  hits.sort((a, b) => a[0] - b[0] || (tree.persons.get(a[1])?.name ?? '').localeCompare(tree.persons.get(b[1])?.name ?? ''));
  return hits.slice(0, limit).map((h) => h[1]);
}

export function installSearch(input: HTMLInputElement, list: HTMLElement, tree: () => Tree, pick: (id: string) => void) {
  let results: string[] = [];
  let active = 0;
  const render = () => {
    const t = tree();
    list.innerHTML = results
      .map((id, i) => {
        const p = t.persons.get(id);
        const b = p?.events.find((e) => (e.tag === 'BIRT' || e.tag === 'CHR') && e.date)?.date?.year;
        const d = p?.events.find((e) => (e.tag === 'DEAT' || e.tag === 'BURI') && e.date)?.date?.year;
        const life = b || d ? `${b ?? '?'}–${d ?? ''}` : '';
        return `<li class="${i === active ? 'active' : ''}" data-id="${id}">${p?.name ?? id} <span class="muted">${life}</span></li>`;
      })
      .join('');
    list.hidden = !results.length;
  };
  const choose = (id: string | undefined) => {
    if (!id) return;
    pick(id);
    input.value = '';
    results = [];
    render();
    input.blur();
  };
  input.addEventListener('input', () => {
    results = searchPersons(tree(), input.value);
    active = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') active = Math.min(results.length - 1, active + 1);
    else if (e.key === 'ArrowUp') active = Math.max(0, active - 1);
    else if (e.key === 'Enter') return choose(results[active]);
    else if (e.key === 'Escape') {
      input.value = '';
      results = [];
      input.blur();
    } else return;
    e.preventDefault();
    render();
  });
  list.addEventListener('mousedown', (e) => {
    const li = (e.target as HTMLElement).closest('li') as HTMLElement | null;
    if (li?.dataset.id) choose(li.dataset.id);
  });
  input.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 150));
}
