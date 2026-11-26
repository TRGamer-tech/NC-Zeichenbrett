#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 TRGamer-tech
# SPDX-License-Identifier: AGPL-3.0-or-later
# Builds the app and creates an installable tarball: dist/zeichenbrett-<version>.tar.gz
set -euo pipefail
cd "$(dirname "$0")"
APP=zeichenbrett
VERSION=$(sed -n 's:.*<version>\(.*\)</version>.*:\1:p' appinfo/info.xml)
npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null
node scripts/l10n.mjs
node build.mjs
rm -rf dist && mkdir -p dist/$APP
cp -r appinfo lib js img css templates LICENSE README.md CHANGELOG.md dist/$APP/
mkdir -p dist/$APP/l10n && cp l10n/*.js l10n/*.json dist/$APP/l10n/
tar -C dist -czf dist/$APP-$VERSION.tar.gz $APP
rm -rf dist/$APP
echo "dist/$APP-$VERSION.tar.gz"
