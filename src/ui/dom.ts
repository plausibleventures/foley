/** The four things this page needs from a framework, which is not enough to justify one. */

export function $<T extends Element = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`missing element: ${selector}`);
  return found;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}

/** Collapse a burst of changes into one expensive redraw. */
export function debounce<A extends unknown[]>(ms: number, run: (...args: A) => void): (...args: A) => void {
  let timer = 0;
  return (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => { run(...args); }, ms) as unknown as number;
  };
}

/** Size a canvas to its CSS box at device resolution, and hand back a context scaled to CSS pixels. */
export function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d');
  if (context === null) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return context;
}

export function readVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}
