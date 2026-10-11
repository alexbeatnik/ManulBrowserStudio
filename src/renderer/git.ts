// The Git pane: which files have changed since the last commit, and what a
// person does about that — look at a change, commit, pull, push — and, when a
// pull meets a change of their own, the conflicts to settle before it is
// finished.
//
// Git itself is in the main process (src/main/git.ts). This draws what it
// says and asks it to act.

import type { GitFile, GitResolution, GitState, GitStatus } from '../shared/api';
import { $, basename, clear, h, reason, studio } from './dom';

export interface GitEvents {
  /**
   * Git is about to read, or to rewrite, files on disk: what is typed and not
   * saved has to be there first. Resolve false to call the action off.
   */
  beforeChange(): Promise<boolean>;
  /** Git has rewritten files on disk; what is open is to be read again. */
  afterChange(): Promise<void>;
  openFile(file: string): void;
  /** Show a changed file as it was and as it is. */
  showDiff(file: GitFile): void;
  /** Git is about to print; bring its output into view. */
  onStart(): void;
  onStatus(text: string): void;
  onError(title: string, message: string): void;
  /** How many files have changed, for whoever shows a count. */
  onCount(changed: number): void;
}

/** How many changed files are given a row. */
const ROWS = 400;

const LETTER: Record<GitState, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflict: '!',
};

const NOTHING: GitStatus = {
  available: true,
  repo: false,
  root: '',
  branch: '',
  upstream: '',
  ahead: 0,
  behind: 0,
  operation: '',
  files: [],
};

export class GitPane {
  private readonly branch = $('git-branch');
  private readonly banner = $('git-operation');
  private readonly list = $('git-list');
  private readonly form = $<HTMLFormElement>('git-commit');
  private readonly message = $<HTMLTextAreaElement>('git-message');
  private readonly commitButton = $<HTMLButtonElement>('git-commit-button');
  private readonly pullButton = $<HTMLButtonElement>('git-pull');
  private readonly pushButton = $<HTMLButtonElement>('git-push');

  private status: GitStatus = NOTHING;
  private hasFolder = false;
  /** Changed files left out of the next commit. Everything else is in it. */
  private readonly left = new Set<string>();
  private busy = false;
  private reading = 0;

  constructor(private readonly events: GitEvents) {
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.commit();
    });
    // Ctrl+Enter in the message commits, as it does wherever a commit is typed.
    this.message.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void this.commit();
      }
    });
    this.message.addEventListener('input', () => this.enable());
    this.pullButton.addEventListener('click', () => void this.act('Pulling…', () => studio.gitPull(), true));
    this.pushButton.addEventListener('click', () => void this.act('Pushing…', () => studio.gitPush(), false));
    $('git-refresh').addEventListener('click', () => void this.refresh());
    this.render();
  }

  /** What git said last. */
  get current(): GitStatus {
    return this.status;
  }

  /** Asks git again. Quiet: this is done whenever something may have changed. */
  async refresh(folder?: string): Promise<void> {
    if (folder !== undefined) this.hasFolder = !!folder;
    const turn = ++this.reading;
    let status = NOTHING;
    try {
      status = await studio.gitStatus();
    } catch {
      // Never rejects, by its contract; an old main process might.
    }
    // An answer overtaken by a later question is not the news.
    if (turn !== this.reading) return;
    this.status = status;
    const names = new Set(status.files.map((f) => f.path));
    for (const path of this.left) if (!names.has(path)) this.left.delete(path);
    this.render();
    this.events.onCount(status.files.length);
  }

  private chosen(): string[] {
    return this.status.files.filter((f) => f.state !== 'conflict' && !this.left.has(f.path)).map((f) => f.path);
  }

  private enable(): void {
    const { repo, operation, upstream, branch } = this.status;
    this.pullButton.disabled = this.busy || !repo || !upstream || operation !== '';
    this.pushButton.disabled = this.busy || !repo || !branch || operation !== '';
    this.pullButton.title = upstream ? `Bring in what ${upstream} has` : 'This branch has no upstream to pull from';
    const committable = repo && !operation && this.chosen().length > 0;
    this.message.disabled = this.busy || !repo || operation !== '';
    this.commitButton.disabled = this.busy || !committable || !this.message.value.trim();
    for (const b of this.list.querySelectorAll<HTMLButtonElement>('button')) b.disabled = this.busy || b.dataset.off === '1';
    for (const b of this.banner.querySelectorAll<HTMLButtonElement>('button')) b.disabled = this.busy || b.dataset.off === '1';
  }

  /**
   * Does one thing with git. `rewrites` says it changes files on disk, or
   * reads them as they are: unsaved text is written first, and open files
   * are read again afterwards.
   */
  private async act(what: string, work: () => Promise<void>, rewrites: boolean): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.enable();
    let ok = false;
    try {
      if (rewrites && !(await this.events.beforeChange())) return false;
      this.events.onStart();
      this.events.onStatus(what);
      await work();
      ok = true;
    } catch (err) {
      this.events.onError('Git', reason(err));
    } finally {
      this.busy = false;
      if (rewrites) await this.events.afterChange();
      await this.refresh();
      this.events.onStatus(ok ? this.summary() : 'Ready');
    }
    return ok;
  }

  /** Where things stand, in a line, after something was done. */
  private summary(): string {
    const { operation, files, ahead, behind } = this.status;
    const conflicts = files.filter((f) => f.state === 'conflict').length;
    if (operation && conflicts) return `${conflicts} ${conflicts === 1 ? 'file is' : 'files are'} in conflict. Settle ${conflicts === 1 ? 'it' : 'them'}, then finish the ${operation}.`;
    if (operation) return `Every conflict is settled. Finish the ${operation}.`;
    if (ahead || behind) return `Git: ${ahead} to push, ${behind} to pull.`;
    return files.length ? `Git: ${files.length} changed.` : 'Git: nothing to commit, nothing to push.';
  }

  private async commit(): Promise<void> {
    const paths = this.chosen();
    const message = this.message.value;
    if (!message.trim() || paths.length === 0) return;
    if (await this.act('Committing…', () => studio.gitCommit(message, paths), true)) this.message.value = '';
    this.enable();
  }

  private resolve(file: GitFile, how: GitResolution): void {
    void this.act(`Settling ${basename(file.path)}…`, () => studio.gitResolve(file.path, how), true);
  }

  // ── drawing ───────────────────────────────────────────────────────────────

  private render(): void {
    const { available, repo, branch, upstream, ahead, behind, operation, files } = this.status;
    clear(this.list);
    clear(this.banner);
    this.banner.classList.add('hidden');
    this.form.classList.toggle('hidden', !repo);

    if (!repo) {
      this.branch.textContent = '';
      const why = !this.hasFolder
        ? 'Open a folder to see what has changed in it.'
        : !available
          ? 'Git was not found on this machine. Install it, and start the app again.'
          : 'This folder is not in a git repository.';
      this.list.append(h('div', { class: 'empty', text: why }));
      if (this.hasFolder && available) {
        this.list.append(
          h(
            'div',
            { class: 'empty' },
            h('button', {
              text: 'Make it one',
              title: 'git init, in this folder — with a .gitignore for what runs leave behind, if it has none',
              // Nothing that is open is rewritten, but the folder has a
              // .gitignore it did not have, for the tree to show.
              onclick: () =>
                void this.act('Making a repository…', () => studio.gitInit(), false).then(() => this.events.afterChange()),
            }),
          ),
        );
      }
      this.enable();
      return;
    }

    const where = branch || 'detached HEAD';
    const distance = upstream ? `${ahead ? ` ↑${ahead}` : ''}${behind ? ` ↓${behind}` : ''}` : ' · no upstream';
    this.branch.textContent = `${where}${distance}`;
    this.branch.title = upstream
      ? `${where} follows ${upstream}: ${ahead} to push, ${behind} to pull, as of the last time git asked`
      : `${where} has no upstream yet; Push gives it one`;

    const conflicts = files.filter((f) => f.state === 'conflict');
    const changes = files.filter((f) => f.state !== 'conflict');

    if (operation) {
      const left = conflicts.length;
      this.banner.classList.remove('hidden');
      this.banner.append(
        h('p', {
          text: left
            ? `A ${operation} is in progress, with ${left} ${left === 1 ? 'file' : 'files'} in conflict.`
            : `A ${operation} is in progress, and every conflict is settled.`,
        }),
        h(
          'div',
          { class: 'actions' },
          h('button', {
            class: 'primary',
            text: `Finish the ${operation}`,
            title: left ? 'Settle every conflict first' : `Conclude the ${operation}`,
            'data-off': left ? '1' : '0',
            onclick: () => void this.act(`Finishing the ${operation}…`, () => studio.gitContinue(), true),
          }),
          h('button', {
            text: 'Give it up',
            title: `Put everything back as it was before the ${operation}`,
            onclick: () => void this.act(`Giving the ${operation} up…`, () => studio.gitAbort(), true),
          }),
        ),
      );
    }

    if (conflicts.length) {
      this.list.append(h('h3', { text: `Conflicts (${conflicts.length})` }));
      for (const file of conflicts) this.list.append(this.conflictRow(file));
    }
    if (changes.length) {
      this.list.append(h('h3', { text: `Changes (${changes.length})` }));
      for (const file of changes.slice(0, ROWS)) this.list.append(this.changeRow(file));
      // A folder of libraries nobody told git to ignore is thousands of
      // files, and a row for each would be the last thing the pane did.
      if (changes.length > ROWS) {
        this.list.append(
          h('div', {
            class: 'empty',
            text: `…and ${changes.length - ROWS} more, which a commit takes with the rest. A .gitignore keeps what is not the project out of this list.`,
          }),
        );
      }
    }
    if (!files.length) {
      this.list.append(
        h('div', {
          class: 'empty',
          text: ahead
            ? `Nothing has changed since the last commit. ${ahead} ${ahead === 1 ? 'commit is' : 'commits are'} waiting to be pushed.`
            : 'Nothing has changed since the last commit.',
        }),
      );
    }
    this.enable();
  }

  private name(file: GitFile): HTMLElement {
    const at = file.path.lastIndexOf('/');
    return h(
      'span',
      { class: 'name' },
      at < 0 ? file.path : file.path.slice(at + 1),
      at < 0 ? null : h('span', { class: 'dir', text: file.path.slice(0, at) }),
    );
  }

  private changeRow(file: GitFile): HTMLElement {
    const box = h('input', { type: 'checkbox', title: 'In the next commit', 'aria-label': `Commit ${file.path}` });
    box.checked = !this.left.has(file.path);
    box.addEventListener('change', () => {
      if (box.checked) this.left.delete(file.path);
      else this.left.add(file.path);
      this.enable();
    });
    const from = file.from ? ` (was ${file.from})` : '';
    return h(
      'div',
      { class: `git-file ${file.state}`, 'data-path': file.path },
      box,
      h(
        'button',
        {
          class: 'show',
          title: `${file.path}${from} — ${file.state}. Show what changed.`,
          onclick: () => this.events.showDiff(file),
        },
        h('span', { class: 'state', text: LETTER[file.state] }),
        this.name(file),
      ),
    );
  }

  private conflictRow(file: GitFile): HTMLElement {
    const settle = (text: string, title: string, how: GitResolution): HTMLElement =>
      h('button', { class: 'quiet', text, title, onclick: () => this.resolve(file, how) });
    return h(
      'div',
      { class: 'git-file conflict', 'data-path': file.path },
      h(
        'button',
        {
          class: 'show',
          title: `${file.path} — changed here and in what is coming in. Open it to settle the conflict.`,
          onclick: () => this.events.openFile(file.file),
        },
        h('span', { class: 'state', text: LETTER.conflict }),
        this.name(file),
      ),
      h(
        'span',
        { class: 'settle' },
        settle('current', 'Keep the file as it was here, and drop what is coming in', 'current'),
        settle('incoming', 'Take the file as it is coming in, and drop what was here', 'incoming'),
        // Never off: what is on disk may be behind what is typed, and the
        // file is saved before git is asked. Git says so if a conflict is left.
        settle(
          'resolved',
          file.unresolved
            ? 'Take the file as it is in the editor, once each conflict in it is settled there'
            : 'The file is as it should be: take it as it is',
          'resolved',
        ),
      ),
    );
  }
}
