'use strict';
// electron-builder afterPack hook.
//
// There are no code-signing identities on the build machine, so electron-builder
// leaves the .app unsigned (mac.identity: null). Apple Silicon refuses to run
// native binaries without at least an ad-hoc signature, so sign the packed app
// with the ad-hoc identity ("-") here - this runs BEFORE the dmg/zip targets are
// produced, so the artifacts contain the signed app. Gatekeeper will still flag
// the app as from an unidentified developer (see README.md).

const path = require('node:path');
const { execFileSync } = require('node:child_process');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing ${appPath}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=1', appPath], { stdio: 'inherit' });
};
