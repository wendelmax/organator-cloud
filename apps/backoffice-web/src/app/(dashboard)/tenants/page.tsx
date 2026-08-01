import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { TenantsClient } from "./ClientPage";

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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
  return <TenantsClient initialTenants={tenants} initialMembers={members} />;
}
