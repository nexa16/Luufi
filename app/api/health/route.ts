import { env } from 'cloudflare:workers';
import { siteIdentity } from '@/lib/auth/site';
import { platformReadiness } from '@/lib/services/deployment-identity';

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!siteIdentity(request))
    return Response.json(
      { error: 'Anmeldung erforderlich.' },
      { status: 401, headers },
    );
  const result = await platformReadiness(env);
  return Response.json(result, {
    status: result.status === 'ok' ? 200 : 503,
    headers,
  });
}
