import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { ServiceDetailsClient } from "./ClientPage";
import { serverApiUrl } from "../../../../lib/public-env";

const API_URL = serverApiUrl();

async function getDeployments(serviceId: string, token: string) {
  const res = await fetch(`${API_URL}/v1/services/${serviceId}/deployments`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

export default async function ServiceDetailPage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  const resolvedParams = await Promise.resolve(params);
  const { id } = resolvedParams;
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  const deployments = token ? await getDeployments(id, token) : [];

  return <ServiceDetailsClient serviceId={id} initialDeployments={deployments} />;
}
