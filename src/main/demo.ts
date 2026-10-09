// The demo project: a folder of hunts, with the small shop they drive, that
// comes with the app.
//
// It is kept inside the app, where nothing can be written, and a run leaves
// reports beside the hunts it ran — so what is opened is a copy, put where a
// person keeps their own files.

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

/** The name of the copy's folder. */
export const DEMO_FOLDER = 'Manul Browser Demo';

/** The hunt that is opened with the project. */
export const DEMO_FIRST_HUNT = path.join('hunts', '01-first-order.hunt');

/**
 * Stands in a hunt for the address of the shop. A page on disk has no address
 * until it is known where the disk is, and a hunt that is to be run a line at
 * a time has to have it written out.
 */
export const SITE_TOKEN = 'DEMO_SITE_URL';

/**
 * Copies into `target` whatever of the demo is not there yet. A file that is
 * there is left alone: it may be the one the person fixed.
 */
export function placeDemo(source: string, target: string): void {
  const site = pathToFileURL(path.join(target, 'site')).href;
  const copy = (from: string, to: string): void => {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
      const src = path.join(from, name);
      const dst = path.join(to, name);
      if (fs.statSync(src).isDirectory()) {
        copy(src, dst);
      } else if (!fs.existsSync(dst)) {
        const bytes = fs.readFileSync(src);
        fs.writeFileSync(dst, name.endsWith('.hunt') ? bytes.toString('utf8').replaceAll(SITE_TOKEN, site) : bytes);
      }
    }
  };
  copy(source, target);
}

/**
 * Puts the demo in the first of `homes` that will take it, and says where it
 * is and which file to show. More than one, because the first choice — the
 * person's documents — is a folder some machines let only known programs
 * write to.
 */
export function openDemo(source: string, homes: string[]): { folder: string; file: string } {
  let failure: unknown = new Error('nowhere to put the demo project');
  for (const home of homes) {
    const folder = path.join(home, DEMO_FOLDER);
    try {
      placeDemo(source, folder);
      return { folder, file: path.join(folder, DEMO_FIRST_HUNT) };
    } catch (err) {
      failure = err;
    }
  }
  throw failure;
}
