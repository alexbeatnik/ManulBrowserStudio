// What may be typed into "install a library".
//
// The text ends up as arguments to npm, so it is checked first: only names of
// packages on the registry, each optionally with a version, range or tag. A
// flag, a path, a URL or a git reference is none of those, and is refused
// rather than passed on.

const NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;
const VERSION = /^[A-Za-z0-9._~^<>=*|+-]+$/;

/** Splits what was typed into package specs, or throws saying what is wrong. */
export function parsePackageSpecs(text: string): string[] {
  const specs = text.trim().split(/[\s,]+/).filter(Boolean);
  if (specs.length === 0) throw new Error('Type the name of a package, for example dayjs.');
  for (const spec of specs) {
    // The version separator is the last `@`; a leading one belongs to a scope.
    const at = spec.lastIndexOf('@');
    const name = at > 0 ? spec.slice(0, at) : spec;
    const version = at > 0 ? spec.slice(at + 1) : '';
    if (!NAME.test(name) || (at > 0 && !VERSION.test(version))) {
      throw new Error(`"${spec}" is not a package name. Use a name from the npm registry, such as dayjs or lodash@4.`);
    }
  }
  return specs;
}

/** True for a name `npm uninstall` can be given as it is. */
export function isPackageName(name: string): boolean {
  return NAME.test(name);
}
