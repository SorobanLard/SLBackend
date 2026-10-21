'use strict';

/*
 * Issue #167 — wire the generated release version into SENTRY_RELEASE at build time.
 *
 * standard-version bumps the `version` field in package.json on every release.
 * This script (run as `postbuild`) writes `SENTRY_RELEASE=sorobanlard-backend@<version>`
 * into `dist/sentry-release.env` so production deployments (`node dist/main`) pick up
 * the exact released version for Sentry error-tracking correlation, even when
 * `npm_package_version` is not exported in the runtime environment.
 */

const fs = require('fs');
const path = require('path');

const pkg = require(path.resolve(process.cwd(), 'package.json'));
const release = `sorobanlard-backend@${pkg.version}`;
const outDir = path.resolve(process.cwd(), 'dist');

if (!fs.existsSync(outDir)) {
  // `nest build` may not have run yet; nothing to write to.
  process.exit(0);
}

fs.writeFileSync(
  path.join(outDir, 'sentry-release.env'),
  `SENTRY_RELEASE=${release}\n`,
  { encoding: 'utf8' },
);

console.log(`[sentry-release] Wired SENTRY_RELEASE=${release} into dist/sentry-release.env`);
