/**
 * Opening a GEDCOM from disk: the "Open …" button, the O key, and dropping a
 * file anywhere on the page. The browser reads the file itself (File API);
 * nothing is sent anywhere. Also the small toast the viewer reports with.
 */

export function toast(message: string, kind: 'info' | 'error' = 'info', ms = 5000) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

export function installOpen(onFile: (file: File) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.ged,.gedcom,.GED';
  input.hidden = true;
  document.body.append(input);
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) onFile(file);
  });
  const pick = () => input.click();
  document.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => b.addEventListener('click', pick));

  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    if ((e.key === 'o' || e.key === 'O') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      pick();
    }
  });

  // Drop anywhere. dragenter/dragleave fire for every child crossed, so count
  // them, or the overlay flickers.
  const overlay = document.querySelector('#drop') as HTMLElement;
  let depth = 0;
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    overlay.classList.add('open');
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.classList.remove('open');
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    // Never let the browser navigate to the dropped file.
    e.preventDefault();
    depth = 0;
    overlay.classList.remove('open');
    const file = e.dataTransfer?.files[0];
    if (file) onFile(file);
  });
}
