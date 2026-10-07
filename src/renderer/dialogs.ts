// Small modal dialogs. Electron has no window.prompt, and a native message box
// would need a round trip through the main process for every question.

import { $, clear, h } from './dom';

const backdrop = (): HTMLElement => $('dialog-backdrop');
const box = (): HTMLElement => $('dialog');

function show<T>(build: (close: (value: T) => void) => { cancel: T; focus?: HTMLElement }): Promise<T> {
  return new Promise((resolve) => {
    const close = (value: T): void => {
      backdrop().classList.add('hidden');
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    clear(box());
    const { cancel, focus } = build(close);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(cancel);
      }
    };
    document.addEventListener('keydown', onKey, true);
    backdrop().classList.remove('hidden');
    (focus ?? box().querySelector<HTMLElement>('button.primary'))?.focus();
  });
}

/** Asks for one line of text. Resolves to '' when dismissed. */
export function ask(title: string, placeholder: string, initial = ''): Promise<string> {
  return show<string>((close) => {
    const input = h('input', { type: 'text', placeholder, value: initial, spellcheck: 'false' });
    const form = h(
      'form',
      {},
      h('h2', { text: title }),
      input,
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'button', text: 'Cancel', onclick: () => close('') }),
        h('button', { type: 'submit', class: 'primary', text: 'Create' }),
      ),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      close(input.value.trim());
    });
    box().append(form);
    return { cancel: '', focus: input };
  });
}

/** Asks a question with named answers. Resolves to the answer's key, or `cancel`. */
export function choose<K extends string>(
  title: string,
  body: Array<string | HTMLElement>,
  answers: Array<{ key: K; label: string; primary?: boolean }>,
  cancel: K,
): Promise<K> {
  return show<K>((close) => {
    box().append(
      h('h2', { text: title }),
      ...body.map((b) => (typeof b === 'string' ? h('p', { text: b }) : b)),
      h(
        'div',
        { class: 'actions' },
        ...answers.map((a) => h('button', { class: a.primary ? 'primary' : '', text: a.label, onclick: () => close(a.key) })),
      ),
    );
    return { cancel };
  });
}

/** Says something the author has to read. */
export function tell(title: string, message: string): Promise<void> {
  return choose(title, [message], [{ key: 'ok', label: 'OK', primary: true }], 'ok').then(() => undefined);
}
