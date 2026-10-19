import { IncidentDetailClient } from "./ClientPage";

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const resolvedParams = await Promise.resolve(params);
  const { id } = resolvedParams;

  return <IncidentDetailClient incidentId={id} />;
}
