interface SwaggerRefreshStats {
  totalEndpoints?: number;
  definitionCount?: number;
  failedDefinitionCount?: number;
}

interface SwaggerRefreshSummary {
  successMessage: string;
  warningMessage: string | null;
  definitionCount: number;
  failedDefinitionCount: number;
}

export function buildSwaggerRefreshSummary(stats: SwaggerRefreshStats = {}, endpointCount = 0): SwaggerRefreshSummary {
  const totalEndpoints = Number.isFinite(endpointCount)
    ? endpointCount
    : Number(stats?.totalEndpoints ?? 0);

  const definitionCount = Number(stats?.definitionCount ?? 0);
  const failedDefinitionCount = Number(stats?.failedDefinitionCount ?? 0);

  const fromDefinitions = definitionCount > 0
    ? ` from ${definitionCount} definition${definitionCount === 1 ? '' : 's'}`
    : '';

  const successMessage = `Swagger refreshed: ${totalEndpoints} endpoint${totalEndpoints === 1 ? '' : 's'}${fromDefinitions}.`;

  const warningMessage = failedDefinitionCount > 0
    ? `Swagger refresh partial: ${failedDefinitionCount} definition${failedDefinitionCount === 1 ? '' : 's'} failed to import.`
    : null;

  return {
    successMessage,
    warningMessage,
    definitionCount,
    failedDefinitionCount,
  };
}
