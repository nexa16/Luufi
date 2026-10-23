interface CloudflareEnv {
  DB: D1Database;
  BUCKET: R2Bucket;
  LEGACY_DB: D1Database;
  LUUFI_ENVIRONMENT?: string;
  LUUFI_SOURCE_BRANCH?: string;
  LUUFI_COMMIT_SHA?: string;
  LUUFI_LOCAL_TEST_MODE?: string;
  TEST_MIGRATIONS: import('@cloudflare/vitest-plugin').D1Migration[];
}
declare namespace Cloudflare {
  interface Env extends CloudflareEnv {}
}
