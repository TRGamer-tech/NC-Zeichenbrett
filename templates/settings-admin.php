<?php
// SPDX-FileCopyrightText: 2026 TRGamer-tech
// SPDX-License-Identifier: AGPL-3.0-or-later
/** @var array $_ */
/** @var \OCP\IL10N $l */
$types = [
	'pdf' => $l->t('PDF documents'),
	'png' => $l->t('PNG images'),
	'jpeg' => $l->t('JPEG images (.jpg, .jpeg)'),
];
?>
<div id="zeichenbrett-admin" class="section zeichenbrett-settings" data-scope="admin">
	<h2><?php p($l->t('Open files in Zeichenbrett by default')); ?></h2>
	<p class="settings-hint"><?php p($l->t('Choose which file types open in Zeichenbrett when they are clicked in Files. This applies to all users; everyone can change it for themselves in their personal settings.')); ?></p>
	<?php foreach ($types as $type => $label): ?>
		<p>
			<input type="checkbox" class="checkbox" id="zeichenbrett-admin-<?php p($type); ?>" data-type="<?php p($type); ?>" <?php if ($_['admin'][$type]) {
				print_unescaped('checked');
			} ?>>
			<label for="zeichenbrett-admin-<?php p($type); ?>"><?php p($label); ?></label>
		</p>
	<?php endforeach; ?>
	<p class="settings-hint"><?php p($l->t('"Draw & annotate" is always available in the "…" menu of a file.')); ?></p>
	<span class="zeichenbrett-status msg" aria-live="polite"></span>
</div>
