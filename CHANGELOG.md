<!--
  - SPDX-FileCopyrightText: 2026 TRGamer-tech
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Changelog

## 1.3.0
- Pen and finger are told apart: once a pen is used (S Pen, Surface Pen, Lenovo/Wacom pens, Apple Pencil), one finger scrolls and only the pen draws. Toolbar switch to change it by hand
- Palm rejection while the pen draws, pen side button and eraser end erase, momentum scrolling
- Much faster zooming in heavy PDFs: only the visible part is re-rendered, outdated renders are cancelled, rendering pauses while you draw, pan or zoom
- Settings pages have a Save button
- Fixed: settings icon was black in the dark theme
- Fixed: reopening a file right after saving could show the previous version (browser cache)

## 1.2.0
- Zeichenbrett can be the default viewer for PDF, PNG and JPEG files (also with files_pdfviewer enabled)
- Admin setting for the default, personal setting to override it
- Translated: German (informal and formal), French, Italian
- Requires Nextcloud 31 or newer

## 1.1.0
- Much simpler: pen, highlighter, eraser, colors, three widths
- Faster opening (pdf-lib is only loaded when saving)

## 1.0.0
- First version
