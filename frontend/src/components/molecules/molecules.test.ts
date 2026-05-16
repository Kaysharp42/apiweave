import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Activity, FileText, Settings } from 'lucide-react';
import {
  Card,
  ConfirmDialog,
  EmptyState,
  FormField,
  KeyValueEditor,
  Modal,
  Panel,
  PanelTabs,
  PromptDialog,
  SearchInput,
  SlidePanel,
  StatusBadge,
  WorkspaceEmptyState,
} from './index';

const noop = (): void => {};

const renderMarkup = (element: React.ReactElement): string => renderToStaticMarkup(element);

const SettingsIcon = (props: React.SVGProps<SVGSVGElement>): React.ReactElement =>
  React.createElement(Settings, props);

const ActivityIcon = (props: React.SVGProps<SVGSVGElement>): React.ReactElement =>
  React.createElement(Activity, props);

const assertIncludes = (markup: string, expected: string): void => {
  assert.ok(markup.includes(expected), `Expected markup to include ${expected}: ${markup}`);
};

const assertNotIncludes = (markup: string, expected: string): void => {
  assert.ok(!markup.includes(expected), `Expected markup not to include ${expected}: ${markup}`);
};

test('Panel and Card render reusable shells with collapse affordances', () => {
  const panelMarkup = renderMarkup(
    React.createElement(
      Panel,
      {
        title: 'Variables',
        icon: SettingsIcon,
        collapsible: true,
        footer: React.createElement('span', null, 'Panel footer'),
        headerActions: React.createElement('span', { className: 'panel-action' }, 'Action'),
        children: React.createElement('div', null, 'Panel body'),
      },
    ),
  );

  assertIncludes(panelMarkup, 'Variables');
  assertIncludes(panelMarkup, 'Panel body');
  assertIncludes(panelMarkup, 'Panel footer');
  assertIncludes(panelMarkup, 'panel-action');
  assertIncludes(panelMarkup, 'aria-expanded="true"');
  assertIncludes(panelMarkup, 'border-border dark:border-border-dark');

  const collapsedCardMarkup = renderMarkup(
    React.createElement(
      Card,
      {
        title: 'Request settings',
        icon: ActivityIcon,
        collapsible: true,
        defaultExpanded: false,
        children: React.createElement('div', null, 'Hidden body'),
      },
    ),
  );

  assertIncludes(collapsedCardMarkup, 'Request settings');
  assertIncludes(collapsedCardMarkup, 'aria-expanded="false"');
  assertNotIncludes(collapsedCardMarkup, 'Hidden body');
});

test('PanelTabs and FormField render accessible panel form abstractions', () => {
  const tabsMarkup = renderMarkup(
    React.createElement(PanelTabs, {
      tabs: [
        { key: 'config', label: 'Config', icon: SettingsIcon },
        { key: 'output', label: 'Output', icon: ActivityIcon },
      ],
      activeTab: 'config',
      onTabChange: noop,
    }),
  );

  assertIncludes(tabsMarkup, 'role="tab"');
  assertIncludes(tabsMarkup, 'aria-selected="true"');
  assertIncludes(tabsMarkup, 'aria-controls="panel-tab-config"');
  assertIncludes(tabsMarkup, 'border-primary dark:border-primary');
  assertIncludes(tabsMarkup, 'Output');

  const fieldMarkup = renderMarkup(
    React.createElement(
      FormField,
      {
        label: 'URL',
        hint: 'Supports variables',
        required: true,
        className: 'field-wrapper',
        children: React.createElement('input', { type: 'text', defaultValue: 'https://api.example.com' }),
      },
    ),
  );

  assertIncludes(fieldMarkup, 'field-wrapper');
  assertIncludes(fieldMarkup, 'URL');
  assertIncludes(fieldMarkup, 'text-status-error');
  assertIncludes(fieldMarkup, 'Supports variables');
  assertIncludes(fieldMarkup, 'https://api.example.com');

  const errorMarkup = renderMarkup(
    React.createElement(
      FormField,
      {
        label: 'Body',
        hint: 'JSON request body',
        error: 'Invalid JSON',
        children: React.createElement('textarea', { defaultValue: '{' }),
      },
    ),
  );

  assertIncludes(errorMarkup, 'Invalid JSON');
  assertNotIncludes(errorMarkup, 'JSON request body');
});

test('Modal, ConfirmDialog, PromptDialog, and SlidePanel render SSR-safe transition states', () => {
  const hiddenModalMarkup = renderMarkup(
    React.createElement(
      Modal,
      {
        isOpen: false,
        onClose: noop,
        title: 'Hidden modal',
        children: React.createElement('div', null, 'Hidden content'),
      },
    ),
  );

  assert.equal(hiddenModalMarkup, '');

  const modalMarkup = renderMarkup(
    React.createElement(
      Modal,
      {
        isOpen: true,
        onClose: noop,
        title: 'Edit workflow',
        size: 'lg',
        footer: React.createElement('button', { type: 'button' }, 'Save'),
        children: React.createElement('div', null, 'Modal body'),
      },
    ),
  );

  assertIncludes(modalMarkup, 'hidden=""');
  assertIncludes(modalMarkup, 'position:fixed');

  const confirmMarkup = renderMarkup(
    React.createElement(ConfirmDialog, {
      open: true,
      onClose: noop,
      onConfirm: noop,
      title: 'Delete workflow?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      intent: 'warning',
    }),
  );

  assertIncludes(confirmMarkup, 'hidden=""');
  assertIncludes(confirmMarkup, 'position:fixed');

  const promptMarkup = renderMarkup(
    React.createElement(PromptDialog, {
      open: true,
      onClose: noop,
      onSubmit: noop,
      title: 'Name workflow',
      message: 'Choose a readable name.',
      placeholder: 'Smoke test',
      defaultValue: 'Draft workflow',
      submitLabel: 'Create',
    }),
  );

  assertIncludes(promptMarkup, 'hidden=""');
  assertIncludes(promptMarkup, 'position:fixed');

  const slidePanelMarkup = renderMarkup(
    React.createElement(
      SlidePanel,
      {
        open: true,
        onClose: noop,
        title: 'Helpers',
        side: 'left',
        size: 'lg',
        showClose: false,
        footer: React.createElement('span', null, 'Panel footer'),
        children: React.createElement('div', null, 'Panel content'),
      },
    ),
  );

  assertIncludes(slidePanelMarkup, 'hidden=""');
  assertIncludes(slidePanelMarkup, 'position:fixed');
});

test('SearchInput and KeyValueEditor render compact input compositions', () => {
  const searchMarkup = renderMarkup(
    React.createElement(SearchInput, {
      value: 'auth',
      onChange: noop,
      placeholder: 'Search workflows',
      size: 'xs',
      className: 'sidebar-search',
      autoFocus: true,
    }),
  );

  assertIncludes(searchMarkup, 'sidebar-search');
  assertIncludes(searchMarkup, 'placeholder="Search workflows"');
  assertIncludes(searchMarkup, 'input-xs');
  assertIncludes(searchMarkup, 'autofocus=""');
  assertIncludes(searchMarkup, 'aria-label="Clear search"');

  const readonlyEditorMarkup = renderMarkup(
    React.createElement(KeyValueEditor, {
      pairs: [{ key: 'Authorization', value: 'Bearer token' }],
      onChange: noop,
      keyPlaceholder: 'Header',
      valuePlaceholder: 'Value',
      readOnly: true,
      className: 'headers-editor',
    }),
  );

  assertIncludes(readonlyEditorMarkup, 'headers-editor');
  assertIncludes(readonlyEditorMarkup, 'Header');
  assertIncludes(readonlyEditorMarkup, 'Authorization');
  assertIncludes(readonlyEditorMarkup, 'Bearer token');
  assertIncludes(readonlyEditorMarkup, 'readonly=""');
  assertNotIncludes(readonlyEditorMarkup, 'Remove row');

  const editableEditorMarkup = renderMarkup(
    React.createElement(KeyValueEditor, {
      pairs: [],
      onChange: noop,
    }),
  );

  assertIncludes(editableEditorMarkup, 'Add');
  assertIncludes(editableEditorMarkup, 'type="button"');
});

test('EmptyState, WorkspaceEmptyState, and StatusBadge render reusable feedback states', () => {
  const emptyMarkup = renderMarkup(
    React.createElement(EmptyState, {
      icon: React.createElement(FileText, { className: 'empty-icon' }),
      title: 'No workflows yet',
      description: 'Create one to get started.',
      action: React.createElement('button', { type: 'button' }, 'Create workflow'),
      className: 'custom-empty-state',
    }),
  );

  assertIncludes(emptyMarkup, 'custom-empty-state');
  assertIncludes(emptyMarkup, 'empty-icon');
  assertIncludes(emptyMarkup, 'No workflows yet');
  assertIncludes(emptyMarkup, 'Create one to get started.');
  assertIncludes(emptyMarkup, 'Create workflow');

  const workspaceMarkup = renderMarkup(
    React.createElement(WorkspaceEmptyState, {
      onNewWorkflow: noop,
      onImport: noop,
      onOpenCollection: noop,
    }),
  );

  assertIncludes(workspaceMarkup, 'Welcome to APIWeave');
  assertIncludes(workspaceMarkup, 'New Workflow');
  assertIncludes(workspaceMarkup, 'Import Workflow');
  assertIncludes(workspaceMarkup, 'Open Collection');
  assertIncludes(workspaceMarkup, 'Ctrl');

  const runningBadgeMarkup = renderMarkup(
    React.createElement(StatusBadge, {
      status: 'running',
      label: 'Executing',
      size: 'xs',
      className: 'run-status',
    }),
  );

  assertIncludes(runningBadgeMarkup, 'badge-warning');
  assertIncludes(runningBadgeMarkup, 'badge-xs');
  assertIncludes(runningBadgeMarkup, 'animate-spin');
  assertIncludes(runningBadgeMarkup, 'Executing');
  assertIncludes(runningBadgeMarkup, 'run-status');

  const defaultBadgeMarkup = renderMarkup(React.createElement(StatusBadge, { status: 'success' }));

  assertIncludes(defaultBadgeMarkup, 'badge-success');
  assertIncludes(defaultBadgeMarkup, 'Success');
});
