// Settling a conflict where it is: in the file, in the editor.
//
// A file git could not merge has both versions of the disputed lines in it,
// between markers. Above each such place the editor offers the three things
// there are to do with it — keep what was here, take what is coming in, keep
// both — and the two sides are coloured so that it can be seen which is which.

import * as monaco from 'monaco-editor';
import { Conflict, findConflicts, Take, takeLines } from '../shared/conflicts';

const OFFERS: Array<{ take: Take; title: string }> = [
  { take: 'current', title: 'Accept current' },
  { take: 'incoming', title: 'Accept incoming' },
  { take: 'both', title: 'Accept both' },
];

/**
 * Puts one side of a conflict in its place. `start` is the 0-based line of
 * its opening marker; returns false when there is no conflict there any more.
 */
export function settleConflict(model: monaco.editor.ITextModel, start: number, take: Take): boolean {
  const lines = model.getLinesContent();
  const conflict = findConflicts(lines).find((c) => c.start === start);
  if (!conflict) return false;
  const kept = takeLines(lines, conflict, take);
  const eol = model.getEOL();
  const first = conflict.start + 1;
  const last = conflict.end + 1;
  // Whole lines go, with the line break that belongs to them: the one after
  // the last, or — at the end of the file — the one before the first.
  let range: monaco.Range;
  let text: string;
  if (last < model.getLineCount()) {
    range = new monaco.Range(first, 1, last + 1, 1);
    text = kept.map((line) => line + eol).join('');
  } else if (first > 1) {
    range = new monaco.Range(first - 1, model.getLineMaxColumn(first - 1), last, model.getLineMaxColumn(last));
    text = kept.map((line) => eol + line).join('');
  } else {
    range = model.getFullModelRange();
    text = kept.join(eol);
  }
  model.pushStackElement();
  model.pushEditOperations([], [{ range, text }], () => null);
  model.pushStackElement();
  return true;
}

function decorations(conflicts: Conflict[]): monaco.editor.IModelDeltaDecoration[] {
  const whole = (from: number, to: number, className: string): monaco.editor.IModelDeltaDecoration => ({
    // 0-based lines, both ends included.
    range: new monaco.Range(from + 1, 1, to + 1, 1),
    options: { isWholeLine: true, className },
  });
  return conflicts.flatMap((c) => {
    const currentEnd = (c.base >= 0 ? c.base : c.middle) - 1;
    return [
      whole(c.start, c.start, 'conflict-marker current'),
      ...(currentEnd > c.start ? [whole(c.start + 1, currentEnd, 'conflict-current')] : []),
      ...(c.base >= 0 ? [whole(c.base, c.middle - 1, 'conflict-base')] : []),
      whole(c.middle, c.middle, 'conflict-marker'),
      ...(c.end - 1 > c.middle ? [whole(c.middle + 1, c.end - 1, 'conflict-incoming')] : []),
      whole(c.end, c.end, 'conflict-marker incoming'),
    ];
  });
}

/** Offers the three choices above every conflict, in any kind of file, and colours its sides. */
export function registerConflicts(editor: monaco.editor.IStandaloneCodeEditor): void {
  const accept = editor.addCommand(0, (_accessor: unknown, uri: string, start: number, take: Take) => {
    const model = monaco.editor.getModel(monaco.Uri.parse(uri));
    if (model) settleConflict(model, start, take);
  });
  if (accept) {
    monaco.languages.registerCodeLensProvider('*', {
      provideCodeLenses(model) {
        const lenses = findConflicts(model.getLinesContent()).flatMap((conflict) =>
          OFFERS.map(({ take, title }) => ({
            range: new monaco.Range(conflict.start + 1, 1, conflict.start + 1, 1),
            command: { id: accept, title, arguments: [model.uri.toString(), conflict.start, take] },
          })),
        );
        return { lenses, dispose: () => undefined };
      },
    });
  }

  const colours = editor.createDecorationsCollection();
  const paint = (): void => {
    const model = editor.getModel();
    colours.set(model ? decorations(findConflicts(model.getLinesContent())) : []);
  };
  editor.onDidChangeModel(paint);
  editor.onDidChangeModelContent(paint);
  paint();
}
