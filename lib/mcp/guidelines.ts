import policies from './policies.json';

export async function getGuideline(id: string) {
  if (!Object.hasOwn(policies, id)) throw new Error('Unbekannte Richtlinie.');
  const policy = policies[id as keyof typeof policies];
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(policy.content),
  );
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return { id, version: policy.version, content: policy.content, sha256 };
}
