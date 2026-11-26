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
<div id="zeichenbrett-personal" class="section zeichenbrett-settings" data-scope="user">
	<h2><?php p($l->t('Open files in Zeichenbrett by default')); ?></h2>
	<p class="settings-hint"><?php p($l->t('Choose what happens when you click one of these files in Files.')); ?></p>
	<table class="zeichenbrett-table">
		<?php foreach ($types as $type => $label): ?>
			<tr>
				<td><label for="zeichenbrett-user-<?php p($type); ?>"><?php p($label); ?></label></td>
				<td>
					<select id="zeichenbrett-user-<?php p($type); ?>" data-type="<?php p($type); ?>">
						<option value="" <?php if ($_['user'][$type] === '') {
							print_unescaped('selected');
						} ?>><?php p($_['admin'][$type]
							? $l->t('Administrator default (Zeichenbrett)')
							: $l->t('Administrator default (normal viewer)')); ?></option>
						<option value="yes" <?php if ($_['user'][$type] === 'yes') {
							print_unescaped('selected');
						} ?>><?php p($l->t('Open in Zeichenbrett')); ?></option>
						<option value="no" <?php if ($_['user'][$type] === 'no') {
							print_unescaped('selected');
						} ?>><?php p($l->t('Open in the normal viewer')); ?></option>
					</select>
				</td>
			</tr>
		<?php endforeach; ?>
	</table>
	<p class="settings-hint"><?php p($l->t('"Draw & annotate" is always available in the "…" menu of a file.')); ?></p>
	<p class="zeichenbrett-actions">
		<button type="button" class="primary zeichenbrett-save" disabled><?php p($l->t('Save')); ?></button>
		<span class="zeichenbrett-status msg" aria-live="polite"></span>
	</p>
</div>
