import { OrderCollection } from '@/app/planning';

type Query = Record<string, string | string[] | undefined>;
export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Query>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const first = (value: string | string[] | undefined) =>
    typeof value === 'string' ? value : value?.[0];
  const initialSelection = {
    milestoneId: first(query.milestoneId),
    status: first(query.status),
    type: first(query.type),
  };
  return (
    <OrderCollection
      key={JSON.stringify({ projectId, ...initialSelection })}
      projectId={projectId}
      initialSelection={initialSelection}
    />
  );
}
