// Tiny DOM builder for the HTML overlay.

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

export function el(tag: string, attrs: Attrs = {}, ...children: (Node | string | null)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') node.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (k === 'class') node.className = String(v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null) node.append(c);
  return node;
}

export function uiRoot(): HTMLElement {
  const root = document.getElementById('ui');
  if (!root) throw new Error('#ui element missing from index.html');
  return root;
}

export function panel(cls: string): HTMLElement {
  const p = el('div', { class: `panel ${cls}` });
  // Keep clicks on panels from reaching the game canvas.
  p.addEventListener('pointerdown', (e) => e.stopPropagation());
  p.addEventListener('wheel', (e) => e.stopPropagation());
  uiRoot().append(p);
  return p;
}
