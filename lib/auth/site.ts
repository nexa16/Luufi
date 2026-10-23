import { env } from 'cloudflare:workers';

/** Sites verifies access and overwrites its identity header before dispatch. */
export function siteIdentity(request: Request): string | null {
  const identity = request.headers.get('oai-authenticated-user-id')?.trim();
  if (identity && identity.length <= 256) return identity;
  const hostname = new URL(request.url).hostname;
  if (
    env.LUUFI_ENVIRONMENT === 'local' &&
    env.LUUFI_LOCAL_TEST_MODE === '1' &&
    (hostname === '127.0.0.1' || hostname === 'localhost')
  )
    return 'local-test-owner';
  return null;
}
