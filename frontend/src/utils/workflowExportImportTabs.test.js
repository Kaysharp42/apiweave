import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeExportImportTab,
  resolveWorkflowExportImportInitialTab,
} from './workflowExportImportTabs.js';

test('normalizeExportImportTab accepts valid tab names case-insensitively', () => {
  assert.equal(normalizeExportImportTab('import'), 'import');
  assert.equal(normalizeExportImportTab('EXPORT'), 'export');
});

test('normalizeExportImportTab returns null for invalid values', () => {
  assert.equal(normalizeExportImportTab(''), null);
  assert.equal(normalizeExportImportTab('something-else'), null);
  assert.equal(normalizeExportImportTab(undefined), null);
});

test('resolveWorkflowExportImportInitialTab prioritizes explicit initialTab', () => {
  assert.equal(
    resolveWorkflowExportImportInitialTab({ initialTab: 'import', mode: 'export' }),
    'import',
  );
});

test('resolveWorkflowExportImportInitialTab supports legacy mode prop', () => {
  assert.equal(
    resolveWorkflowExportImportInitialTab({ mode: 'import' }),
    'import',
  );
});

test('resolveWorkflowExportImportInitialTab falls back to export', () => {
  assert.equal(resolveWorkflowExportImportInitialTab({}), 'export');
  assert.equal(resolveWorkflowExportImportInitialTab({ mode: 'unknown' }), 'export');
});

test('resolveWorkflowExportImportInitialTab supports reopen context changes', () => {
  const openedFromWorkflowRow = resolveWorkflowExportImportInitialTab({
    initialTab: 'export',
    mode: undefined,
  });

  const reopenedFromSidebarImport = resolveWorkflowExportImportInitialTab({
    initialTab: 'import',
    mode: undefined,
  });

  assert.equal(openedFromWorkflowRow, 'export');
  assert.equal(reopenedFromSidebarImport, 'import');
});
