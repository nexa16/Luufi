import type { DeploymentIdentity } from '@/lib/services/deployment-identity';

export function EnvironmentBanner({
  identity,
}: {
  identity: DeploymentIdentity | null;
}) {
  if (!identity || identity.environment === 'production') return null;

  const label = 'Vorschau';

  return (
    <aside
      aria-label="Vorschauumgebung"
      className="sticky top-0 z-50 border-b border-cyan-200/30 bg-cyan-200 px-4 py-2 text-center text-xs font-bold tracking-wide text-slate-950 shadow-lg shadow-black/20"
    >
      {label} · {identity.sourceBranch} · {identity.commitSha.slice(0, 7)}
    </aside>
  );
}
