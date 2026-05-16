import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from 'reactflow';
import { Activity, Save } from 'lucide-react';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Input } from './Input';
import { TextArea } from './TextArea';
import { Badge } from './Badge';
import { Toggle } from './Toggle';
import { Spinner } from './Spinner';
import { Skeleton } from './Skeleton';
import { Divider } from './Divider';
import { HorizontalDivider } from './HorizontalDivider';
import { Tooltip } from './Tooltip';
import { Toast } from './Toast';
import { BaseNode } from './flow/BaseNode';
import { NodeHandle } from './flow/NodeHandle';
import { NodeActionMenu } from './flow/NodeActionMenu';

const renderMarkup = (element: React.ReactElement): string => renderToStaticMarkup(element);

const renderFlowMarkup = (element: React.ReactElement): string =>
  renderMarkup(React.createElement(ReactFlowProvider, null, element));

const assertIncludes = (markup: string, expected: string): void => {
  assert.ok(markup.includes(expected), `Expected markup to include ${expected}: ${markup}`);
};

test('Button renders typed variants, loading state, icon state, and dark mode classes', () => {
  const primaryMarkup = renderMarkup(
    React.createElement(Button, {
      variant: 'primary',
      intent: 'default',
      size: 'lg',
      fullWidth: true,
      children: 'Save',
    }),
  );

  assertIncludes(primaryMarkup, 'type="button"');
  assertIncludes(primaryMarkup, 'px-6 py-3 text-base');
  assertIncludes(primaryMarkup, 'dark:bg-[#22d3ee]');
  assertIncludes(primaryMarkup, 'w-full');
  assertIncludes(primaryMarkup, 'Save');

  const loadingMarkup = renderMarkup(
    React.createElement(Button, {
      loading: true,
      icon: React.createElement(Save, { className: 'save-icon' }),
      children: 'Saving',
    }),
  );

  assertIncludes(loadingMarkup, 'disabled=""');
  assertIncludes(loadingMarkup, 'animate-spin');
  assert.ok(!loadingMarkup.includes('save-icon'), 'Icon should be hidden while loading');
});

test('IconButton renders accessible icon-only controls without duplicating button styles', () => {
  const markup = renderMarkup(
    React.createElement(IconButton, {
      size: 'md',
      variant: 'success',
      disabled: true,
      className: 'custom-icon-button',
      children: React.createElement(Save, { 'aria-hidden': true }),
    }),
  );

  assertIncludes(markup, 'type="button"');
  assertIncludes(markup, 'h-9 w-9');
  assertIncludes(markup, 'bg-green-600');
  assertIncludes(markup, 'opacity-50 cursor-not-allowed');
  assertIncludes(markup, 'custom-icon-button');
});

test('Input and TextArea render labels, help/error states, and dark mode classes', () => {
  const inputMarkup = renderMarkup(
    React.createElement(Input, {
      id: 'api-url',
      label: 'URL',
      helperText: 'Supports variables',
      size: 'sm',
      placeholder: 'https://api.example.com',
    }),
  );

  assertIncludes(inputMarkup, 'for="api-url"');
  assertIncludes(inputMarkup, 'input-sm');
  assertIncludes(inputMarkup, 'dark:bg-surface-dark-raised');
  assertIncludes(inputMarkup, 'aria-describedby="api-url-helper"');

  const textAreaMarkup = renderMarkup(
    React.createElement(TextArea, {
      id: 'request-body',
      label: 'Body',
      error: 'Invalid JSON',
      size: 'lg',
      autoResize: true,
      value: '{',
      readOnly: true,
    }),
  );

  assertIncludes(textAreaMarkup, 'for="request-body"');
  assertIncludes(textAreaMarkup, 'textarea-lg');
  assertIncludes(textAreaMarkup, 'textarea-error');
  assertIncludes(textAreaMarkup, 'resize-none overflow-hidden');
  assertIncludes(textAreaMarkup, 'Invalid JSON');
});

test('Badge, Toggle, Spinner, Skeleton, and dividers render expected primitive classes', () => {
  const badgeMarkup = renderMarkup(
    React.createElement(Badge, { variant: 'warning', size: 'xs', children: 'Draft' }),
  );
  assertIncludes(badgeMarkup, 'badge-warning');
  assertIncludes(badgeMarkup, 'badge-xs');

  const toggleMarkup = renderMarkup(
    React.createElement(Toggle, {
      id: 'autosave-toggle',
      label: 'Auto-save',
      checked: true,
      readOnly: true,
      variant: 'success',
      size: 'lg',
    }),
  );
  assertIncludes(toggleMarkup, 'for="autosave-toggle"');
  assertIncludes(toggleMarkup, 'toggle-success');
  assertIncludes(toggleMarkup, 'toggle-lg');
  assertIncludes(toggleMarkup, 'checked=""');

  const spinnerMarkup = renderMarkup(React.createElement(Spinner, { type: 'bars', size: 'sm', color: 'text-primary' }));
  assertIncludes(spinnerMarkup, 'role="status"');
  assertIncludes(spinnerMarkup, 'loading-bars');
  assertIncludes(spinnerMarkup, 'loading-sm');

  const skeletonMarkup = renderMarkup(React.createElement(Skeleton, { variant: 'rect', count: 2, width: 120, height: 24 }));
  assertIncludes(skeletonMarkup, 'space-y-2');
  assertIncludes(skeletonMarkup, 'width:120px;height:24px');

  const dividerMarkup = renderMarkup(React.createElement(Divider, { direction: 'vertical', text: 'or' }));
  assertIncludes(dividerMarkup, 'divider-horizontal');

  const horizontalDividerMarkup = renderMarkup(React.createElement(HorizontalDivider, { className: 'my-2' }));
  assertIncludes(horizontalDividerMarkup, 'role="separator"');
  assertIncludes(horizontalDividerMarkup, 'dark:bg-border-dark');
});

test('Tooltip and Toast render safely for non-DOM tests', () => {
  const tooltipChild = React.createElement('span', { className: 'tooltip-child' }, 'Hover me');
  const tooltipMarkup = renderMarkup(
    React.createElement(Tooltip, { content: 'Details', disabled: true, children: tooltipChild }),
  );
  assertIncludes(tooltipMarkup, 'tooltip-child');
  assertIncludes(tooltipMarkup, 'Hover me');

  const toastMarkup = renderMarkup(React.createElement(Toast));
  assertIncludes(toastMarkup, 'aria-label="Notifications alt+T"');
  assertIncludes(toastMarkup, 'aria-live="polite"');
});

test('Flow atoms render with ReactFlow provider and preserve connection affordances', () => {
  const handleMarkup = renderFlowMarkup(
    React.createElement(NodeHandle, {
      id: 'success',
      type: 'source',
      position: 'bottom',
      color: '!bg-status-success',
    }),
  );
  assertIncludes(handleMarkup, 'data-handleid="success"');
  assertIncludes(handleMarkup, 'data-handlepos="bottom"');
  assertIncludes(handleMarkup, '!bg-status-success');

  const baseNodeMarkup = renderFlowMarkup(
    React.createElement(
      BaseNode,
      {
        title: 'HTTP Request',
        icon: React.createElement(Activity, { 'aria-hidden': true }),
        status: 'success',
        selected: true,
        defaultExpanded: true,
        showMenu: false,
        statusBadgeText: 'OK',
      },
      React.createElement('div', null, 'Node body'),
    ),
  );
  assertIncludes(baseNodeMarkup, 'HTTP Request');
  assertIncludes(baseNodeMarkup, 'border-status-success');
  assertIncludes(baseNodeMarkup, 'ring-2 ring-primary/70');
  assertIncludes(baseNodeMarkup, 'aria-expanded="true"');
  assertIncludes(baseNodeMarkup, 'Node body');

  const menuMarkup = renderMarkup(React.createElement(NodeActionMenu, { nodeId: 'node-1', collapsible: true }));
  assertIncludes(menuMarkup, 'aria-label="Node actions"');
  assertIncludes(menuMarkup, 'aria-haspopup="menu"');
  assertIncludes(menuMarkup, 'aria-expanded="false"');
});
