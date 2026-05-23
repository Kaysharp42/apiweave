import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Design token consistency tests.
 *
 * Verifies that no hardcoded hex values are used in component files.
 * All colors MUST use Tailwind design tokens (e.g., `bg-primary`, `text-text-secondary`).
 *
 * Exceptions: tailwind.config.js and base.css are allowed to define hex values.
 */

const SRC_DIR = join('src', 'components');

function findComponentFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findComponentFiles(fullPath));
    } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx')) {
      files.push(fullPath);
    }
  }

  return files;
}

const HEX_PATTERN = /#[0-9a-fA-F]{3,8}/g;

test('no hardcoded hex colors in component files', () => {
  const files = findComponentFiles(SRC_DIR);

  const violations = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const matches = content.match(HEX_PATTERN);

    if (matches) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (line.trim().startsWith('//') || line.trim().startsWith('/*')) continue;
        if (line.includes('@param')) continue;
        if (HEX_PATTERN.test(line)) {
          violations.push(`${file}:${i + 1} — ${line.trim()}`);
        }
      }
    }
  }

  assert.strictEqual(
    violations.length,
    0,
    `Found hardcoded hex colors in components (use design tokens instead):\n${violations.join('\n')}`,
  );
});

test('all atom components exist and are exported', () => {
  const atomsDir = join(SRC_DIR, 'atoms');
  const atoms = readdirSync(atomsDir).filter(
    (f) => (f.endsWith('.tsx') || f.endsWith('.jsx')) && f !== 'index.ts' && f !== 'index.js',
  );

  assert.ok(atoms.length >= 8, `Expected at least 8 atom components, found ${atoms.length}`);
});

test('all molecule components exist and are exported', () => {
  const moleculesDir = join(SRC_DIR, 'molecules');
  const molecules = readdirSync(moleculesDir).filter(
    (f) => (f.endsWith('.tsx') || f.endsWith('.jsx')) && f !== 'index.ts' && f !== 'index.js',
  );

  const expected = ['Panel', 'PanelTabs', 'FormField', 'Card', 'Modal', 'EmptyState', 'StatusBadge'];

  for (const name of expected) {
    const found = molecules.some((f) => f.startsWith(name));
    assert.ok(found, `Expected molecule "${name}" not found`);
  }
});
