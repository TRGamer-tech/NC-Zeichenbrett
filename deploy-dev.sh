#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 TRGamer-tech
# SPDX-License-Identifier: AGPL-3.0-or-later
# Dev helper: rebuild and copy into a local Nextcloud's custom_apps folder (path as $1)
set -euo pipefail
cd "$(dirname "$0")"
node scripts/l10n.mjs >/dev/null
node build.mjs >/dev/null
rm -rf "$1/zeichenbrett" && mkdir -p "$1/zeichenbrett"
cp -r appinfo lib js img css templates "$1/zeichenbrett/"
mkdir -p "$1/zeichenbrett/l10n" && cp l10n/*.js l10n/*.json "$1/zeichenbrett/l10n/"
