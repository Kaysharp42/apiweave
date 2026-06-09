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
import { IconSwitch } from './IconSwitch';
import { BaseNode } from './flow/BaseNode';
import { NodeHandle } from './flow/NodeHandle';
import { NodeActionMenu } from './flow/NodeActionMenu';

const renderMarkup = (element: React.ReactElement): string => renderToStaticMarkup(element);

const renderFlowMarkup = (element: React.ReactElement): string =>
  renderMarkup(React.createElement(ReactFlowProvider, null, element));

const assertIncludes = (markup: string, expected: string): void => {
  assert.ok(markup.includes(expected), `Expected markup to include ${expected}: ${markup}`);
};

test('Button renders typed variants, loading state, icon state, focus-visible, cursor, and dark mode classes', () => {
  const primaryMarkup = renderMarkup(
    React.createElement(Button, {
      variant: 'primary',
      intent: 'default',
      size: 'lg',
      fullWidth: true,
    }, 'Save'),
  );

  assertIncludes(primaryMarkup, 'type="button"');
  assertIncludes(primaryMarkup, 'px-6 py-3 text-base');
  assertIncludes(primaryMarkup, 'w-full');
  assertIncludes(primaryMarkup, 'Save');
  assertIncludes(primaryMarkup, 'focus-visible:outline-2');
  assertIncludes(primaryMarkup, 'focus-visible:outline-[var(--aw-primary)]');
  assertIncludes(primaryMarkup, 'focus-visible:outline-offset-[var(--aw-focus-ring-offset)]');
  assertIncludes(primaryMarkup, 'cursor-pointer');
  assertIncludes(primaryMarkup, 'bg-[var(--aw-primary)]');
  assertIncludes(primaryMarkup, 'dark:text-primary-dark');

  const loadingMarkup = renderMarkup(
    React.createElement(Button, {
      loading: true,
      icon: React.createElement(Save, { className: 'save-icon' }),
    }, 'Saving'),
  );

  assertIncludes(loadingMarkup, 'disabled=""');
  assertIncludes(loadingMarkup, 'aria-busy="true"');
  assertIncludes(loadingMarkup, 'animate-spin');
  assertIncludes(loadingMarkup, 'motion-reduce:animate-none');
  assertIncludes(loadingMarkup, 'opacity-50 cursor-not-allowed pointer-events-none');
  assert.ok(!loadingMarkup.includes('save-icon'), 'Icon should be hidden while loading');
});

test('IconButton renders accessible icon-only controls with focus-visible, cursor, and dark mode classes', () => {
  const markup = renderMarkup(
    React.createElement(IconButton, {
      size: 'md',
      variant: 'success',
      disabled: true,
      className: 'custom-icon-button',
    }, React.createElement(Save, { 'aria-hidden': true })),
  );

  assertIncludes(markup, 'type="button"');
  assertIncludes(markup, 'h-9 w-9');
  assertIncludes(markup, 'bg-status-success');
  assertIncludes(markup, 'dark:bg-[var(--aw-status-success)]');
  assertIncludes(markup, 'opacity-50 cursor-not-allowed pointer-events-none');
  assertIncludes(markup, 'focus-visible:outline-2');
  assertIncludes(markup, 'focus-visible:outline-[var(--aw-primary)]');
  assertIncludes(markup, 'custom-icon-button');
});

test('Input and TextArea render labels, help/error states, dark mode classes, and focus-visible', () => {
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
  assertIncludes(inputMarkup, 'focus-visible:outline-2');
  assertIncludes(inputMarkup, 'focus-visible:outline-[var(--aw-primary)]');

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
  assertIncludes(textAreaMarkup, 'focus-visible:outline-2');
  assertIncludes(textAreaMarkup, 'focus-visible:outline-[var(--aw-primary)]');
});

test('Badge, Toggle, Spinner, Skeleton, and dividers render expected primitive classes', () => {
  const badgeMarkup = renderMarkup(React.createElement(Badge, { variant: 'warning', size: 'xs' }, 'Draft'));
  assertIncludes(badgeMarkup, 'text-status-warning');
  assertIncludes(badgeMarkup, 'dark:text-[var(--aw-status-warning)]');
  assertIncludes(badgeMarkup, 'text-xxs');

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
  assertIncludes(toggleMarkup, 'focus-visible:outline-2');
  assertIncludes(toggleMarkup, 'cursor-pointer');

  const spinnerMarkup = renderMarkup(React.createElement(Spinner, { type: 'bars', size: 'sm', color: 'text-primary' }));
  assertIncludes(spinnerMarkup, '<output');
  assertIncludes(spinnerMarkup, 'aria-label="Loading"');
  assertIncludes(spinnerMarkup, 'loading-bars');
  assertIncludes(spinnerMarkup, 'loading-sm');
  assertIncludes(spinnerMarkup, 'motion-reduce:animate-none');

  const skeletonMarkup = renderMarkup(React.createElement(Skeleton, { variant: 'rect', count: 2, width: 120, height: 24 }));
  assertIncludes(skeletonMarkup, 'space-y-2');
  assertIncludes(skeletonMarkup, 'width:120px;height:24px');
  assertIncludes(skeletonMarkup, 'motion-reduce:animate-none');

  const dividerMarkup = renderMarkup(React.createElement(Divider, { direction: 'vertical', text: 'or' }));
  assertIncludes(dividerMarkup, 'divider-horizontal');
  assertIncludes(dividerMarkup, 'dark:before:bg-border-dark');

  const horizontalDividerMarkup = renderMarkup(React.createElement(HorizontalDivider, { className: 'my-2' }));
  assertIncludes(horizontalDividerMarkup, '<hr');
  assertIncludes(horizontalDividerMarkup, 'bg-[var(--aw-border)]');
});

test('IconSwitch renders with focus-visible, cursor, and dark mode classes', () => {
  const switchMarkup = renderMarkup(
    React.createElement(IconSwitch, {
      checked: true,
      onCheckedChange: () => {},
      checkedIcon: React.createElement(Save, { size: 12 }),
      uncheckedIcon: React.createElement(Activity, { size: 12 }),
      checkedLabel: 'On',
      uncheckedLabel: 'Off',
      intent: 'primary',
    }),
  );

  assertIncludes(switchMarkup, 'role="switch"');
  assertIncludes(switchMarkup, 'aria-checked="true"');
  assertIncludes(switchMarkup, 'cursor-pointer');
  assertIncludes(switchMarkup, 'focus-visible:outline-2');
  assertIncludes(switchMarkup, 'focus-visible:outline-[var(--aw-primary)]');
  assertIncludes(switchMarkup, 'dark:bg-[var(--aw-primary-light)]/20');
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
  assertIncludes(handleMarkup, '!w-3.5');
  assertIncludes(handleMarkup, '!h-3.5');
  assertIncludes(handleMarkup, 'aria-label="source handle"');
  assertIncludes(handleMarkup, '!border-[var(--aw-surface-raised)]');

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
  assertIncludes(baseNodeMarkup, 'ring-2');
  assertIncludes(baseNodeMarkup, 'ring-[var(--aw-primary)]/50');
  assertIncludes(baseNodeMarkup, 'shadow-[var(--aw-shadow-overlay)]');
  assertIncludes(baseNodeMarkup, 'aria-label="Node status: Success"');
  assertIncludes(baseNodeMarkup, 'aria-expanded="true"');
  assertIncludes(baseNodeMarkup, 'Node body');

  const runningNodeMarkup = renderFlowMarkup(
    React.createElement(
      BaseNode,
      {
        title: 'Delay',
        status: 'running',
        selected: false,
        showMenu: false,
        statusBadgeText: 'Running',
      },
      React.createElement('div', null, 'Wait 2s'),
    ),
  );
  assertIncludes(runningNodeMarkup, 'border-status-running');
  assertIncludes(runningNodeMarkup, 'animate-pulse-border');
  assertIncludes(runningNodeMarkup, 'motion-reduce:animate-none');
  assertIncludes(runningNodeMarkup, 'aria-label="Node status: Running"');

  const errorNodeMarkup = renderFlowMarkup(
    React.createElement(
      BaseNode,
      {
        title: 'Assert',
        status: 'error',
        selected: false,
        showMenu: false,
      },
      React.createElement('div', null, 'Failed'),
    ),
  );
  assertIncludes(errorNodeMarkup, 'border-status-error');
  assertIncludes(errorNodeMarkup, 'aria-label="Node status: Error"');

  const menuMarkup = renderMarkup(React.createElement(NodeActionMenu, { nodeId: 'node-1', collapsible: true }));
  assertIncludes(menuMarkup, 'aria-label="Node actions"');
  assertIncludes(menuMarkup, 'aria-haspopup="menu"');
  assertIncludes(menuMarkup, 'aria-expanded="false"');
  assertIncludes(menuMarkup, 'focus-visible:outline-2');
  assertIncludes(menuMarkup, 'focus-visible:outline-[var(--aw-primary)]');
});
