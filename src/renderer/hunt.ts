// The .hunt language as the editor knows it: colours, completion, hover and
// formatting.
//
// None of this is grammar. The engine decides what a line means; the editor
// only needs to recognise the words the DSL contract lists, and those come
// from the catalogue — the bundled copy of the contract, widened by whatever
// the installed engine reports — so a verb the engine gains shows up here
// without this file changing.

import * as monaco from 'monaco-editor';
import type { Catalogue, CatalogueEntry } from '../core/catalogue';
import { formatHunt } from '../core/huntDoc';

export const HUNT = 'hunt';
export const THEME = 'manul-dark';

/** Words the DSL accepts that no catalogue label spells out. */
const EXTRA_VERBS = ['CHOOSE', 'PAUSE', 'ENTER', 'GO', 'PYTHON', 'HOST', 'DROP', 'OVER', 'ROW'];
const CONTROL = ['IF', 'ELIF', 'ELSE', 'REPEAT', 'TIMES', 'FOR', 'EACH', 'WHILE', 'IN', 'END', 'USE'];
const TYPE_HINTS = ['button', 'link', 'field', 'dropdown', 'checkbox', 'radio', 'element', 'input'];
const STATES = ['NOT', 'present', 'enabled', 'disabled', 'checked', 'visible', 'hidden', 'disappear', 'softly'];

let catalogue: Catalogue = { version: '', commands: [], metadata: [], blocks: [] };

/** The all-capitals words of a label: `WAIT FOR element` → [WAIT, FOR]. */
function verbWords(label: string): string[] {
  return label.split(/\s+/).filter((w) => /^[A-Z]{2,}$/.test(w));
}

function tokens(verbs: string[]): monaco.languages.IMonarchLanguage {
  const alt = (words: string[]): string => words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const variable = /\{[A-Za-z_]\w*\}/;
  return {
    ignoreCase: true,
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'comment'],
        // The names of borrowed blocks are names, whatever words they are
        // made of: `Open the shop` is not an OPEN step.
        // `[@]`: Monarch reads a bare `@import` as one of its own attributes.
        [/^\s*[@]import\s*:/, { token: 'annotation', next: '@imported' }],
        [/^\s*USE\b/, { token: 'keyword.control', next: '@title' }],
        [/^\s*@\w+\s*:/, 'annotation'],
        [/^\s*\[(?:END\s+)?(?:SETUP|TEARDOWN)\]\s*$/, 'keyword.block'],
        [/^\s*(?:\d+\.\s*)?STEP\b\s*\d*\s*:/, { token: 'keyword.block', next: '@title' }],
        [/^\s*DONE\b\.?/, 'keyword.block'],
        [new RegExp(`\\b(?:${alt(CONTROL)})\\b`), 'keyword.control'],
        [/\b(?:NEAR|INSIDE|ON\s+HEADER|ON\s+FOOTER)\b/, 'keyword.qualifier'],
        [new RegExp(`\\b(?:${alt(verbs)})\\b`), 'keyword'],
        [new RegExp(`\\b(?:${alt(TYPE_HINTS)})\\b`), 'type'],
        [new RegExp(`\\b(?:${alt(STATES)})\\b`), 'constant'],
        [variable, 'variable'],
        // A quote with no partner on its line is flagged where it stands,
        // instead of colouring the rest of the file as one long string.
        [/'[^']*$/, 'string.invalid'],
        [/"[^"]*$/, 'string.invalid'],
        [/'/, { token: 'string.quote', next: '@single' }],
        [/"/, { token: 'string.quote', next: '@double' }],
        [/\bhttps?:\/\/[^\s'"]+/, 'string.link'],
        [/\b\d+(?:\.\d+)?\b/, 'number'],
      ],
      title: [
        [/.+$/, { token: 'entity.name', next: '@pop' }],
        [/$/, { token: '', next: '@pop' }],
      ],
      imported: [
        [/\s+from\s+(?=['"])/, { token: 'keyword.control', next: '@pop' }],
        [/[^,\s]+/, 'entity.name'],
        [/[,\s]+/, ''],
        [/$/, { token: '', next: '@pop' }],
      ],
      single: [
        [variable, 'variable'],
        [/[^'{]+/, 'string'],
        [/\{/, 'string'],
        [/'/, { token: 'string.quote', next: '@pop' }],
      ],
      double: [
        [variable, 'variable'],
        [/[^"{]+/, 'string'],
        [/\{/, 'string'],
        [/"/, { token: 'string.quote', next: '@pop' }],
      ],
    },
  };
}

function applyGrammar(): void {
  const verbs = new Set(EXTRA_VERBS);
  for (const c of catalogue.commands) {
    for (const w of verbWords(c.label)) if (!CONTROL.includes(w) && w !== 'STEP' && w !== 'DONE') verbs.add(w);
  }
  monaco.languages.setMonarchTokensProvider(HUNT, tokens([...verbs]));
}

/** The catalogue entry a line begins with: the one whose capitalised words match the most. */
export function entryForLine(line: string): CatalogueEntry | undefined {
  const text = line.trim().replace(/^\d+\.\s+/, '').toUpperCase();
  if (!text) return undefined;
  let best: CatalogueEntry | undefined;
  let bestLen = 0;
  for (const entry of [...catalogue.commands, ...catalogue.metadata, ...catalogue.blocks]) {
    const head = entry.label.startsWith('@') || entry.label.startsWith('[') ? entry.label.toUpperCase() : verbWords(entry.label).join(' ');
    if (!head || head.length <= bestLen) continue;
    if (text === head || text.startsWith(`${head} `) || text.startsWith(`${head}:`) || (head.endsWith(':') && text.startsWith(head))) {
      best = entry;
      bestLen = head.length;
    }
  }
  return best;
}

/** Names of the variables a document mentions, in order of appearance. */
function variablesIn(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/\{([A-Za-z_]\w*)\}/g)) names.add(m[1]);
  return [...names];
}

function completions(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.languages.CompletionList {
  const line = model.getLineContent(position.lineNumber);
  const before = line.slice(0, position.column - 1);
  const Kind = monaco.languages.CompletionItemKind;
  const asSnippet = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;

  const brace = before.match(/\{(\w*)$/);
  if (brace) {
    const range = new monaco.Range(position.lineNumber, position.column - brace[1].length, position.lineNumber, position.column);
    // The editor closes a brace as it is typed; do not add a second one.
    const closed = line[position.column - 1] === '}';
    return {
      suggestions: variablesIn(model.getValue()).map((name) => ({
        label: name,
        kind: Kind.Variable,
        insertText: closed ? name : `${name}}`,
        range,
      })),
    };
  }

  const indent = before.length - before.trimStart().length;
  const typed = before.slice(indent);
  // Still on the first word: a verb, a header or a block marker goes here.
  if (/^[@[\w ]*$/.test(typed) && typed.split(/\s+/).length <= 2) {
    const range = new monaco.Range(position.lineNumber, indent + 1, position.lineNumber, position.column);
    const item = (entry: CatalogueEntry, kind: monaco.languages.CompletionItemKind, sort: string) => ({
      label: { label: entry.label, description: entry.uiText !== entry.label ? entry.uiText : undefined },
      kind,
      insertText: entry.snippet,
      insertTextRules: asSnippet,
      filterText: `${entry.label} ${entry.uiText}`,
      documentation: entry.description,
      sortText: sort,
      range,
    });
    return {
      suggestions: [
        ...catalogue.commands.map((c, i) => item(c, Kind.Function, `1${String(i).padStart(3, '0')}`)),
        ...catalogue.metadata.map((c, i) => item(c, Kind.Property, `2${String(i).padStart(3, '0')}`)),
        ...catalogue.blocks.map((c, i) => item(c, Kind.Struct, `3${String(i).padStart(3, '0')}`)),
      ],
    };
  }

  // Right after a quoted target: what kind of element it is.
  const hint = before.match(/['"]\s+(\w*)$/);
  if (hint) {
    const range = new monaco.Range(position.lineNumber, position.column - hint[1].length, position.lineNumber, position.column);
    return { suggestions: TYPE_HINTS.map((t) => ({ label: t, kind: Kind.TypeParameter, insertText: t, range })) };
  }
  return { suggestions: [] };
}

function hover(model: monaco.editor.ITextModel, position: monaco.Position): monaco.languages.Hover | undefined {
  const line = model.getLineContent(position.lineNumber);
  const entry = entryForLine(line);
  if (!entry) return undefined;
  // Only over the words that make the step what it is, not over its values.
  const indent = line.length - line.trimStart().length;
  const firstQuote = line.search(/['"]/);
  const end = firstQuote > 0 ? firstQuote : line.length;
  if (position.column - 1 < indent || position.column - 1 > end) return undefined;
  return {
    range: new monaco.Range(position.lineNumber, indent + 1, position.lineNumber, end + 1),
    contents: [{ value: `**${entry.label}** — \`${entry.uiText}\`` }, { value: entry.description }],
  };
}

/** Registers the language once. The catalogue can be given, or replaced, later. */
export function registerHunt(): void {
  monaco.languages.register({ id: HUNT, extensions: ['.hunt'], aliases: ['Hunt', 'hunt'] });
  monaco.languages.setLanguageConfiguration(HUNT, {
    comments: { lineComment: '#' },
    brackets: [
      ['{', '}'],
      ['[', ']'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: "'", close: "'", notIn: ['string'] },
      { open: '"', close: '"', notIn: ['string'] },
    ],
    surroundingPairs: [
      { open: "'", close: "'" },
      { open: '"', close: '"' },
      { open: '{', close: '}' },
    ],
    onEnterRules: [
      // A STEP header or a block opener is followed by its body, one level in.
      {
        beforeText: /^\s*(?:(?:\d+\.\s*)?STEP\b.*:.*|\[(?:SETUP|TEARDOWN)\]|(?:IF|ELIF|ELSE|REPEAT|FOR\s+EACH|WHILE)\b.*:)\s*$/i,
        action: { indentAction: monaco.languages.IndentAction.Indent },
      },
    ],
  });
  applyGrammar();

  monaco.languages.registerCompletionItemProvider(HUNT, {
    triggerCharacters: ['@', '[', '{'],
    provideCompletionItems: completions,
  });
  monaco.languages.registerHoverProvider(HUNT, { provideHover: hover });
  monaco.languages.registerDocumentFormattingEditProvider(HUNT, {
    provideDocumentFormattingEdits(model) {
      const eol = model.getEOL();
      const formatted = formatHunt(model.getLinesContent()).join(eol);
      if (formatted === model.getValue()) return [];
      return [{ range: model.getFullModelRange(), text: formatted }];
    },
  });

  monaco.editor.defineTheme(THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
      { token: 'annotation', foreground: 'c792ea' },
      { token: 'keyword', foreground: 'e0a458', fontStyle: 'bold' },
      { token: 'keyword.block', foreground: '6aa9e9', fontStyle: 'bold' },
      { token: 'keyword.control', foreground: 'c792ea', fontStyle: 'bold' },
      { token: 'keyword.qualifier', foreground: '4ec9b0', fontStyle: 'bold' },
      { token: 'entity.name', foreground: 'd7dae0', fontStyle: 'bold' },
      { token: 'type', foreground: '4ec9b0' },
      { token: 'constant', foreground: '82aaff' },
      { token: 'variable', foreground: 'f78c6c' },
      { token: 'string', foreground: 'a8d08d' },
      { token: 'string.quote', foreground: '7fa86a' },
      { token: 'string.link', foreground: '7fb7e6', fontStyle: 'underline' },
      { token: 'string.invalid', foreground: 'e5645f' },
      { token: 'number', foreground: 'f2c97d' },
    ],
    colors: {
      'editor.background': '#15171c',
      'editor.lineHighlightBackground': '#1c1f26',
      'editorGutter.background': '#15171c',
      'editorLineNumber.foreground': '#4b5160',
      'editorLineNumber.activeForeground': '#9aa1ae',
      'editorWidget.background': '#1c1f26',
      'editorSuggestWidget.background': '#1c1f26',
      'editorSuggestWidget.selectedBackground': '#2f3540',
      'editorHoverWidget.background': '#1c1f26',
    },
  });
}

/** Gives the language its catalogue; the colours follow the verbs in it. */
export function setCatalogue(next: Catalogue): void {
  catalogue = next;
  applyGrammar();
}
