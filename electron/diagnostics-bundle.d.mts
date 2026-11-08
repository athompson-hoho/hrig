export type DiagnosticsStatus = 'ok' | 'failed' | 'unknown';
export interface DiagnosticsRequest {
  schemaVersion: 1;
  source: 'represented-connection-doctor';
  checks: { availability: 'available' | 'unavailable'; entries: { name: string; status: DiagnosticsStatus }[] };
  settings: Record<string, string | number | boolean>;
}
export interface DiagnosticsBundle extends DiagnosticsRequest { versions: Record<'hrig' | 'electron' | 'chromium' | 'node', string> }
export type DiagnosticsExportResult = { status: 'saved' | 'canceled' | 'error' };
export const CHECK_CATALOG: readonly string[];
export function projectDiagnosticsRequest(report: unknown, effective: unknown, eligible: boolean): string;
export function parseDiagnosticsRequest(text: unknown): DiagnosticsRequest;
export function createDiagnosticsBundle(request: unknown, versions: unknown): string;
