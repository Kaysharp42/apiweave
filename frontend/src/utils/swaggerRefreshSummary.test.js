import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSwaggerRefreshSummary } from './swaggerRefreshSummary.js';

test('buildSwaggerRefreshSummary formats success message with definition count', () => {
  const summary = buildSwaggerRefreshSummary({ definitionCount: 3, failedDefinitionCount: 0 }, 124);

  assert.equal(summary.successMessage, 'Swagger refreshed: 124 endpoints from 3 definitions.');
  assert.equal(summary.warningMessage, null);
});

test('buildSwaggerRefreshSummary includes warning for partial failures', () => {
  const summary = buildSwaggerRefreshSummary({ definitionCount: 4, failedDefinitionCount: 1 }, 88);

  assert.equal(summary.successMessage, 'Swagger refreshed: 88 endpoints from 4 definitions.');
  assert.equal(summary.warningMessage, 'Swagger refresh partial: 1 definition failed to import.');
});

test('buildSwaggerRefreshSummary handles missing stats safely', () => {
  const summary = buildSwaggerRefreshSummary({}, 1);

  assert.equal(summary.successMessage, 'Swagger refreshed: 1 endpoint.');
  assert.equal(summary.warningMessage, null);
});
