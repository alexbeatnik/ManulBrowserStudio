// Turning something picked on the page into a line of a hunt.
//
// This is authoring help, not grammar: the engine decides what a line means.
// What is written here is the form its own scanner drafts for the same kind of
// control, so a step inserted from the page panel reads like one written by
// hand.

import type { MapElement } from './api';

/**
 * Quotes a label for a step. A label is written in single quotes unless it
 * contains one, in which case double quotes are used; the DSL has no escape.
 */
export function quote(label: string): string {
  const text = label.replace(/\s+/g, ' ').trim();
  return text.includes("'") ? `"${text}"` : `'${text}'`;
}

/** The step that acts on a mapped element, and where the caret belongs in it. */
export function stepForElement(el: MapElement): { text: string; caret?: number } {
  const label = quote(el.label);
  const role = el.role.toLowerCase();
  switch (role) {
    case 'button':
      return { text: `CLICK the ${label} button` };
    case 'link':
      return { text: `CLICK the ${label} link` };
    case 'checkbox':
    case 'switch':
      return { text: `CHECK the checkbox for ${label}` };
    case 'radio':
      return { text: `CLICK the ${label} radio` };
    case 'combobox':
    case 'listbox':
    case 'select': {
      const head = "SELECT '";
      return { text: `${head}' from the ${label} dropdown`, caret: head.length };
    }
  }
  if (el.editable || role === 'textbox' || role === 'searchbox') {
    const text = `FILL ${label} field with ''`;
    return { text, caret: text.length - 1 };
  }
  return { text: `CLICK the ${label}` };
}

/** The step that asserts a mapped element is on the page. */
export function verifyForElement(el: MapElement): string {
  return `VERIFY that ${quote(el.label)} is present`;
}

/**
 * The step on a line, as it would be handed to the engine on its own: without
 * indentation or a list number, and nothing at all for a line that is not a
 * step — a comment, a header, a STEP title, a block marker.
 */
export function runnableLine(raw: string): string {
  const text = raw.trim().replace(/^\d+\.\s+/, '');
  if (!text || text.startsWith('#') || text.startsWith('@')) return '';
  if (/^STEP\b\s*\d*\s*:/i.test(text) || /^DONE\b\.?$/i.test(text)) return '';
  if (/^\[(END\s+)?(SETUP|TEARDOWN)\]$/i.test(text)) return '';
  // The opener of a block is not a step without its body.
  if (/^(IF|ELIF|ELSE|REPEAT|FOR\s+EACH|WHILE)\b.*:\s*$/i.test(text)) return '';
  return text;
}
