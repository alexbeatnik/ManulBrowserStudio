// The conflicts git leaves in a file it could not merge, and what taking a
// side of one comes to.
//
//     <<<<<<< HEAD
//     what is here                       ← current
//     ||||||| base                       ← only with merge.conflictStyle diff3
//     what both started from
//     =======
//     what is coming in                  ← incoming
//     >>>>>>> origin/main

/** One conflict, by the 0-based lines its markers are on. */
export interface Conflict {
  start: number;
  /** The `|||||||` line, or -1 when the common ancestor is not shown. */
  base: number;
  middle: number;
  end: number;
}

export type Take = 'current' | 'incoming' | 'both';

const START = /^<{7}(?: |$)/;
const BASE = /^\|{7}(?: |$)/;
const MIDDLE = /^={7}$/;
const END = /^>{7}(?: |$)/;

/** Every whole conflict in the text. A marker with no partner is not one. */
export function findConflicts(lines: string[]): Conflict[] {
  const found: Conflict[] = [];
  let open: Conflict | undefined;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (START.test(line)) {
      open = { start: i, base: -1, middle: -1, end: -1 };
    } else if (!open) {
      return;
    } else if (BASE.test(line) && open.middle < 0) {
      open.base = i;
    } else if (MIDDLE.test(line) && open.middle < 0) {
      open.middle = i;
    } else if (END.test(line) && open.middle >= 0) {
      found.push({ ...open, end: i });
      open = undefined;
    }
  });
  return found;
}

/** True when the text still has a conflict in it. */
export function hasConflicts(text: string): boolean {
  return findConflicts(text.split('\n')).length > 0;
}

/** The lines a conflict becomes when a side of it is taken. */
export function takeLines(lines: string[], conflict: Conflict, take: Take): string[] {
  const current = lines.slice(conflict.start + 1, conflict.base >= 0 ? conflict.base : conflict.middle);
  const incoming = lines.slice(conflict.middle + 1, conflict.end);
  if (take === 'current') return current;
  if (take === 'incoming') return incoming;
  return [...current, ...incoming];
}

/** The text with every conflict in it settled the same way. */
export function takeAll(text: string, take: Take): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  // Last first, so that the lines of the ones above keep their numbers.
  for (const conflict of findConflicts(lines).reverse()) {
    lines.splice(conflict.start, conflict.end - conflict.start + 1, ...takeLines(lines, conflict, take));
  }
  return lines.join(eol);
}
