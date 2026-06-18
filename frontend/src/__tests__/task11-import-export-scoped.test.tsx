import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  workflowImportOpenapiUrl,
  workflowExportUrl,
  workflowImportDryRunUrl,
  workflowImportUrl,
  workflowImportHarUrl,
  workflowImportCurlUrl,
  workflowImportOpenapiUrlUrl,
  workflowImportOpenapiRemoteUrl,
} from '../utils/scopedApi';
import API_BASE_URL from '../utils/api';

// ---------------------------------------------------------------------------
// (a) OpenAPI dry-run uses scoped route
// ---------------------------------------------------------------------------

describe('Task 11: Import panels and Swagger refresh migration', () => {
  describe('scopedApi URL builders for import/export', () => {
    it('workflowImportOpenapiUrl builds scoped dry-run URL', () => {
      const url = workflowImportOpenapiUrl('ws-1', true);
      expect(url).toBe(
        `${API_BASE_URL}/api/workspaces/ws-1/workflows/import/openapi/dry-run`,
      );
    });

    it('workflowImportOpenapiUrl builds scoped import URL (no dry-run)', () => {
      const url = workflowImportOpenapiUrl('ws-1');
      expect(url).toBe(
        `${API_BASE_URL}/api/workspaces/ws-1/workflows/import/openapi`,
      );
    });

    it('workflowImportHarUrl builds scoped HAR dry-run URL', () => {
      const url = workflowImportHarUrl('ws-2', true);
      expect(url).toBe(
        `${API_BASE_URL}/api/workspaces/ws-2/workflows/import/har/dry-run`,
      );
    });

    it('workflowImportCurlUrl builds scoped curl dry-run URL', () => {
      const url = workflowImportCurlUrl('ws-3', true);
      expect(url).toBe(
        `${API_BASE_URL}/api/workspaces/ws-3/workflows/import/curl/dry-run`,
      );
    });

    it('workflowImportOpenapiUrlUrl builds base URL for remote OpenAPI fetch', () => {
      const url = workflowImportOpenapiUrlUrl('ws-1');
      expect(url).toBe(
        `${API_BASE_URL}/api/workspaces/ws-1/workflows/import/openapi/url`,
      );
    });

    it('workflowImportOpenapiRemoteUrl builds full URL with query params', () => {
      const url = workflowImportOpenapiRemoteUrl('ws-1', 'https://example.com/swagger.json', true);
      expect(url).toContain('/api/workspaces/ws-1/workflows/import/openapi/url');
      expect(url).toContain('swagger_url=https%3A%2F%2Fexample.com%2Fswagger.json');
      expect(url).toContain('sanitize=true');
    });

    it('workflowImportUrl builds scoped import URL', () => {
      const url = workflowImportUrl('ws-1');
      expect(url).toBe(
        `${API_BASE_URL}/api/workspaces/ws-1/workflows/import`,
      );
    });

    it('workflowImportDryRunUrl builds scoped dry-run URL', () => {
      const url = workflowImportDryRunUrl('ws-1');
      expect(url).toBe(
        `${API_BASE_URL}/api/workspaces/ws-1/workflows/import/dry-run`,
      );
    });

    // (b) workflow export uses scoped route
    it('workflowExportUrl builds scoped export URL', () => {
      const url = workflowExportUrl('ws-1', 'wf-42', true);
      expect(url).toBe(
        `${API_BASE_URL}/api/workspaces/ws-1/workflows/wf-42/export?include_environment=true`,
      );
    });

    it('workflowExportUrl encodes special characters', () => {
      const url = workflowExportUrl('ws#1', 'wf&2', false);
      expect(url).toContain('/api/workspaces/ws%231/workflows/wf%262/export');
      expect(url).toContain('include_environment=false');
    });
  });

  // ---------------------------------------------------------------------------
  // Source-code migration assertions
  // ---------------------------------------------------------------------------

  describe('source files no longer use legacy /api/workflows URLs', () => {
    const componentDir = resolve(__dirname, '..', 'components');
    const hooksDir = resolve(__dirname, '..', 'hooks');

    const filesToCheck = [
      resolve(componentDir, 'CurlImport.tsx'),
      resolve(componentDir, 'OpenAPIImport.tsx'),
      resolve(componentDir, 'HARImport.tsx'),
      resolve(componentDir, 'WorkflowExportImport.tsx'),
      resolve(componentDir, 'ImportToNodesPanel.tsx'),
      resolve(hooksDir, 'useSwaggerRefresh.ts'),
    ];

    for (const filePath of filesToCheck) {
      const fileName = filePath.split(/[/\\]/).pop();

      it(`${fileName} does not contain legacy /api/workflows URLs`, () => {
        const source = readFileSync(filePath, 'utf-8');
        // Match /api/workflows but NOT /api/workspaces/.../workflows
        const legacyPattern = /\/api\/workflows(?!\/)/g;
        // Also catch bare /api/workflows/ that isn't under /api/workspaces/
        const legacyPattern2 = /`?\$\{[^}]*\}\/api\/workflows/g;
        const legacyPattern3 = /['"]\/api\/workflows[/'"?]/g;

        const matches = [
          ...source.matchAll(legacyPattern),
          ...source.matchAll(legacyPattern2),
          ...source.matchAll(legacyPattern3),
        ];

        // Filter out any that are actually scoped (contain /workspaces/)
        const realLegacy = matches.filter((m) => {
          const start = Math.max(0, m.index! - 50);
          const context = source.slice(start, m.index! + m[0].length);
          return !context.includes('/workspaces/');
        });

        expect(realLegacy).toHaveLength(0);
      });

      it(`${fileName} imports from scopedApi`, () => {
        const source = readFileSync(filePath, 'utf-8');
        expect(source).toContain('scopedApi');
      });

      it(`${fileName} uses useScopeContext`, () => {
        const source = readFileSync(filePath, 'utf-8');
        expect(source).toContain('useScopeContext');
      });
    }
  });
});
