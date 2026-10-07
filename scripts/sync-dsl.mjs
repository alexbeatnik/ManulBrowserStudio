// Regenerates data/dsl.json from the engine's DSL contract.
//
//   node scripts/sync-dsl.mjs [path/to/MANUL_DSL_CONTRACT.md]
//
// The contract is the source of truth for what a .hunt file may contain; the
// copy here is what the editor completes, describes and colours from when no
// engine is around to ask. It defaults to a manul-browser checkout sitting
// beside this one.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = resolve(process.argv[2] ?? '../manul-browser/spec/contracts/MANUL_DSL_CONTRACT.md');
const markdown = readFileSync(source, 'utf8');
const block = markdown.match(/```json\r?\n([\s\S]*?)```/);
if (!block) throw new Error(`no JSON block in ${source}`);
const contract = JSON.parse(block[1]);

const pick = (entry, keys) => Object.fromEntries(keys.filter((k) => entry[k] !== undefined).map((k) => [k, entry[k]]));

const dsl = {
  version: contract.version,
  commands: contract.commands.map((c) => pick(c, ['id', 'label', 'uiText', 'snippet', 'description', 'category'])),
  metadata: contract.metadata.map((c) => pick(c, ['id', 'label', 'uiText', 'snippet', 'description'])),
  hookBlocks: contract.hookBlocks.map((c) => pick(c, ['id', 'label', 'openTag', 'closeTag', 'snippet', 'description'])),
  qualifiers: contract.contextualQualifiers.map((c) => pick(c, ['id', 'syntax', 'description'])),
  typeHints: contract.elementTypeHint.validHints,
};

writeFileSync('data/dsl.json', `${JSON.stringify(dsl, null, 2)}\n`);
console.log(`data/dsl.json: ${dsl.commands.length} commands from ${source} (contract ${dsl.version})`);
