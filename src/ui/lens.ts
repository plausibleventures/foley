/**
 * One pane that explains whatever the pointer is on.
 *
 * The alternative — a paragraph under every slider — costs four screens of rail before anybody
 * reaches the export button, and the paragraph you have already read three times is worse than no
 * paragraph at all. This is the same words in a place that does not grow.
 *
 * Its height is reserved rather than fitted, so nothing below it moves when the text changes.
 */

import { el } from './dom.js';

export interface Lens {
  readonly node: HTMLElement;
  /** Attach a row: hovering or focusing anything inside it shows this note. */
  watch(row: HTMLElement, title: string, note: string): void;
}

export function createLens(idle: string): Lens {
  const title = el('b');
  const body = el('span');
  const node = el('p', { class: 'lens lens--idle' }, [title, body]);

  const set = (heading: string, text: string, lit: boolean): void => {
    title.textContent = heading;
    body.textContent = text;
    node.classList.toggle('lens--idle', !lit);
  };
  set('', idle, false);

  return {
    node,
    watch(row, heading, note) {
      const show = (): void => {
        set(heading, note, true);
        row.classList.add('axis--lit');
      };
      const hide = (): void => {
        row.classList.remove('axis--lit');
        // Only clear if nothing else has claimed the pane since.
        if (title.textContent === heading) set('', idle, false);
      };
      row.addEventListener('pointerenter', show);
      row.addEventListener('focusin', show);
      row.addEventListener('pointerleave', hide);
      row.addEventListener('focusout', hide);
    },
  };
}
