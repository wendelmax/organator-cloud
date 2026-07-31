import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { ServicesClient } from "./ClientPage";

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function getServices(token: string, tenantId: string) {
  const res = await fetch(`${API_URL}/v1/services/tenant/${tenantId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!res.ok) return [];
  return res.json();
}

export default async function ServicesPage() {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  const tenantId = (session as any)?.user?.tenantId || (session as any)?.tenantId;

  const services = (token && tenantId) ? await getServices(token, tenantId) : [];
  return <ServicesClient initialServices={services} />;
}
