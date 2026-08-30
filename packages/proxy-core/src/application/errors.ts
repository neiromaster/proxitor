/**
 * Shared error-to-message formatting: an Error keeps its message, any other
 * thrown value is stringified. Lives in application (not domain/error.ts)
 * because every consumer of it — adapters and bin included — may import
 * application, while the adapters-application-only rule forbids adapters from
 * importing domain.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
