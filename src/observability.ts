const REQUEST_IDS = new WeakMap<Request, string>();

export function assignRequestId(request: Request): string {
  const id = crypto.randomUUID();
  REQUEST_IDS.set(request, id);
  return id;
}

export function getRequestId(request: Request): string {
  return REQUEST_IDS.get(request) ?? "unknown";
}

export function logOperational(
  event: string,
  fields: Record<string, string | number | boolean | undefined> = {},
): void {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      severity: "error",
      event,
      ...fields,
    }),
  );
}
