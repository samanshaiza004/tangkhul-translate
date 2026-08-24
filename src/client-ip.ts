import { isIP } from "node:net";

export interface ClientAddressContext {
  request: Request;
  server: unknown;
}

interface BunServerWithRequestIP {
  requestIP?: (request: Request) => { address: string } | null;
}

function socketAddress({ request, server }: ClientAddressContext): string {
  const bunServer = server as BunServerWithRequestIP | null;
  return bunServer?.requestIP?.(request)?.address ?? "unknown";
}

/**
 * Resolve the address that Fly Proxy authenticated for this request.
 *
 * Fly-Client-IP is trusted only because the deployment exposes the process
 * through Fly Proxy. X-Forwarded-For is deliberately ignored: a caller can
 * supply it when reaching the application directly.
 */
export function resolveFlyClientKey(context: ClientAddressContext): string {
  const flyClientIp = context.request.headers.get("Fly-Client-IP")?.trim();
  if (flyClientIp && isIP(flyClientIp) !== 0) return flyClientIp;
  return socketAddress(context);
}
