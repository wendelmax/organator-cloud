import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { TenantsClient } from "./ClientPage";

async function getTenants(token: string) {
  const res = await fetch("http://localhost:3001/v1/tenants", {
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
  return <TenantsClient initialTenants={tenants} />;
}
