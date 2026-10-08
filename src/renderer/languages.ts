// JavaScript and TypeScript, for hook scripts.
//
// The editor ships with a TypeScript service; what it lacks is anything to
// resolve `import … from 'manul-browser'` or `node:fs` against, because it
// runs in the window and sees no disk. The main process supplies the
// declarations of both from the app's own copies, and the service is set up
// for the kind of file a hook script is: a Node ES module.
//
// Python and Go files are coloured and nothing more. Completion for those
// needs a language server each — Pyright, gopls — which this app does not
// carry.

import * as monaco from 'monaco-editor';
import { studio } from './dom';

/**
 * The root of the file system a path is on, as the service names it: the
 * drive for a Windows path, `/` for any other.
 *
 * The service looks for a package in `node_modules` folders from the
 * importing file upwards and stops at the root of that file's volume. On
 * Windows that root is the drive — `file:///c%3A/` — so declarations parked
 * at `file:///node_modules` are above anything it will ever look in.
 */
function volumeRoot(folder: string): string {
  const drive = folder.match(/^[A-Za-z]:/);
  return monaco.Uri.file(drive ? `${drive[0]}\\` : '/').toString();
}

let declarations: Promise<Array<{ path: string; content: string }>> | undefined;

/** Sets the service up for files under `folder`. Called again when the folder changes. */
export async function setUpScriptLanguages(folder: string): Promise<number> {
  const ts = monaco.typescript;
  const options: monaco.typescript.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    allowJs: true,
    allowNonTsExtensions: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    // No DOM: a hook script runs in Node, and offering `document` there would
    // be offering something that is not there.
    lib: ['esnext'],
    noEmit: true,
  };
  declarations ??= studio.typeLibraries();
  const libraries = await declarations;
  const root = volumeRoot(folder);
  for (const defaults of [ts.javascriptDefaults, ts.typescriptDefaults]) {
    defaults.setCompilerOptions(options);
    defaults.setEagerModelSync(true);
    defaults.setExtraLibs(libraries.map((lib) => ({ content: lib.content, filePath: root + lib.path })));
  }
  return libraries.length;
}

/**
 * The names the TypeScript service offers at a position in an open file.
 * Used by the scripted check of the app; the editor asks through its own
 * completion provider.
 */
export async function completionsAt(file: string, line: number, column: number): Promise<string[]> {
  const uri = monaco.Uri.file(file);
  const model = monaco.editor.getModel(uri);
  if (!model) return [];
  const isTs = /\.tsx?$/i.test(file);
  const getWorker = await (isTs ? monaco.typescript.getTypeScriptWorker() : monaco.typescript.getJavaScriptWorker());
  const worker = await getWorker(uri);
  const offset = model.getOffsetAt({ lineNumber: line, column });
  const result = (await worker.getCompletionsAtPosition(uri.toString(), offset)) as
    | { entries?: Array<{ name: string }> }
    | undefined;
  return (result?.entries ?? []).map((e) => e.name);
}
