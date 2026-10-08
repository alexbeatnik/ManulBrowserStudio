// Run by the packager once the app folder is laid out, before the installer
// is made from it: puts npm in the app's resources.
//
// npm is not an ordinary dependency to pack. It keeps its own dependencies in
// a node_modules inside its folder, and the packager, which copies the app's
// dependency tree as the package manager describes it, leaves that folder
// out — of the archive and of `extraResources` alike. What arrives is an npm
// that cannot find `graceful-fs`. So the folder is copied here, whole.

const { cp, rm } = require('node:fs/promises');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const resources =
    context.electronPlatformName === 'darwin'
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources');
  const target = path.join(resources, 'npm');
  await rm(target, { recursive: true, force: true });
  await cp(path.join(context.packager.projectDir, 'node_modules', 'npm'), target, { recursive: true });
};
