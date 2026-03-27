interface ManifestData {
  endpoints: Array<{ route: string; description: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

interface ManifestDiff {
  service: string;
  added: string[];
  removed: string[];
  changed: string[];
}

interface AuditReport {
  date: string;
  services_audited: number;
  services_with_drift: number;
  triage_accuracy: number;
  drift_details: ManifestDiff[];
  tokens_used: number;
}

/**
 * Diff two manifest endpoint lists to find discrepancies.
 */
export function diffManifests(
  current: Pick<ManifestData, "endpoints">,
  fresh: Pick<ManifestData, "endpoints">
): Omit<ManifestDiff, "service"> {
  const currentRoutes = new Map(
    current.endpoints.map((e) => [e.route, e])
  );
  const freshRoutes = new Map(
    fresh.endpoints.map((e) => [e.route, e])
  );

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [route, endpoint] of freshRoutes) {
    if (!currentRoutes.has(route)) {
      added.push(`${route}: ${endpoint.description}`);
    } else {
      const existing = currentRoutes.get(route)!;
      if (existing.description !== endpoint.description) {
        changed.push(`${route}: "${existing.description}" -> "${endpoint.description}"`);
      }
    }
  }

  for (const [route, endpoint] of currentRoutes) {
    if (!freshRoutes.has(route)) {
      removed.push(`${route}: ${endpoint.description}`);
    }
  }

  return { added, removed, changed };
}

/**
 * Build the accuracy audit report.
 */
export function buildAuditReport(
  date: string,
  diffs: ManifestDiff[]
): AuditReport {
  const withDrift = diffs.filter(
    (d) => d.added.length > 0 || d.removed.length > 0 || d.changed.length > 0
  );

  return {
    date,
    services_audited: diffs.length,
    services_with_drift: withDrift.length,
    triage_accuracy: diffs.length > 0 ? (diffs.length - withDrift.length) / diffs.length : 1,
    drift_details: withDrift,
    tokens_used: 0, // populated by caller
  };
}
