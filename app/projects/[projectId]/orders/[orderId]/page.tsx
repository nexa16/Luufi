import { OrderDetail } from '@/app/planning';

export default async function OrderPage({
  params,
}: {
  params: Promise<{ projectId: string; orderId: string }>;
}) {
  const { projectId, orderId } = await params;
  return <OrderDetail projectId={projectId} orderId={orderId} />;
}
