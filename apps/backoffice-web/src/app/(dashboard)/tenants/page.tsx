import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { TenantsClient } from "./ClientPage";
import { serverApiUrl } from "../../../lib/public-env";

const API_URL = serverApiUrl();

async function getTenants(token: string) {
  const res = await fetch(`${API_URL}/v1/tenants`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!res.ok) return [];
  return res.json();
}

async function getMembers(token: string) {
  const res = await fetch(`${API_URL}/v1/tenants/members`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!res.ok) return [];
  return res.json();
}

export default async function TenantsPage() {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  const tenants = token ? await getTenants(token) : [];
  const members = token ? await getMembers(token) : [];
  // Criar tenants é exclusivo do admin da plataforma (POST /v1/tenants).
  const canCreateTenant = (session as any)?.user?.role === "PLATFORM_ADMIN";
  return (
    <TenantsClient
      initialTenants={tenants}
      initialMembers={members}
      canCreateTenant={canCreateTenant}
    />
  );
}
