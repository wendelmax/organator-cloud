"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const isPlatformAdmin = (session?.user as any)?.role === "PLATFORM_ADMIN";
  const token = (session as any)?.accessToken;
  const [tenants, setTenants] = useState<any[]>([]);
  const [switching, setSwitching] = useState(false);
  const [tenantSearch, setTenantSearch] = useState("");
  const apiUrl = (
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
  ).replace(/\/v1$/, "");
  const activeTenant = tenants.find(
    (item) => item.tenant.id === (session?.user as any)?.tenantId,
  )?.tenant;
  const visibleTenants = tenants.filter((item) =>
    item.tenant.name.toLowerCase().includes(tenantSearch.toLowerCase()),
  );
  const orgPath = (path: string) =>
    activeTenant ? `/org/${activeTenant.slug}${path}` : path;
  useEffect(() => {
    if (token)
      fetch(`${apiUrl}/v1/tenants/available`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : []))
        .then(setTenants)
        .catch(() => setTenants([]));
  }, [token, apiUrl]);
  async function switchTenant(tenantId: string) {
    setSwitching(true);
    const res = await fetch(`${apiUrl}/v1/auth/switch-tenant`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tenantId }),
    });
    if (res.ok) {
      const data = await res.json();
      const selected = tenants.find((item) => item.tenant.id === tenantId);
      await update({
        accessToken: data.access_token,
        tenantId,
        role: selected?.role,
      });
      if (selected) router.push(`/org/${selected.tenant.slug}/settings`);
    }
    setSwitching(false);
  }

  useEffect(() => {
    if (
      status === "authenticated" &&
      (session?.user as any)?.mustChangePassword
    ) {
      router.replace("/set-password");
    }
  }, [status, session, router]);

  return (
    <div className="flex h-screen bg-neutral-950 text-white">
      {/* Sidebar Simples */}
      <aside className="w-64 bg-neutral-900 border-r border-neutral-800 p-6 flex flex-col gap-6">
        <div className="text-2xl font-bold tracking-tight bg-gradient-to-r from-blue-500 to-cyan-400 bg-clip-text text-transparent">
          Organator
        </div>
        {tenants.length > 1 && (
          <div className="space-y-2">
            <input
              value={tenantSearch}
              onChange={(event) => setTenantSearch(event.target.value)}
              placeholder="Buscar organização"
              className="w-full rounded border border-neutral-700 bg-neutral-800 p-2 text-sm text-white"
            />
            <select
              disabled={switching}
              className="w-full rounded bg-neutral-800 border border-neutral-700 p-2 text-sm text-white"
              value={(session?.user as any)?.tenantId || ""}
              onChange={(e) => switchTenant(e.target.value)}
            >
              {visibleTenants.map((item) => (
                <option key={item.tenant.id} value={item.tenant.id}>
                  {item.tenant.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <Link
          href="/tenants"
          className="text-xs text-neutral-400 hover:text-white"
        >
          + Criar nova organização
        </Link>
        <nav className="flex flex-col gap-2">
          <Link
            href={orgPath("/dashboard")}
            className="px-4 py-2 rounded-md hover:bg-neutral-800 transition"
          >
            Dashboard
          </Link>
          <Link
            href="/tenants"
            className="px-4 py-2 rounded-md hover:bg-neutral-800 transition"
          >
            Tenants
          </Link>
          <Link
            href={orgPath("/services")}
            className="px-4 py-2 rounded-md hover:bg-neutral-800 transition"
          >
            Services Catalog
          </Link>
          <Link
            href="/portal"
            className="px-4 py-2 rounded-md hover:bg-neutral-800 transition text-blue-400"
          >
            Developer Portal
          </Link>
          <Link
            href={orgPath("/api-keys")}
            className="px-4 py-2 rounded-md hover:bg-neutral-800 transition"
          >
            API Keys
          </Link>
          <Link
            href={orgPath("/sessions")}
            className="px-4 py-2 rounded-md hover:bg-neutral-800 transition"
          >
            Sessões
          </Link>
          <Link
            href={orgPath("/settings")}
            className="px-4 py-2 rounded-md hover:bg-neutral-800 transition"
          >
            Configurações
          </Link>
          <Link
            href={orgPath("/invitations")}
            className="px-4 py-2 rounded-md hover:bg-neutral-800 transition"
          >
            Convites
          </Link>
          <Link
            href={orgPath("/billing")}
            className="px-4 py-2 rounded-md hover:bg-neutral-800 transition"
          >
            Billing (Stripe)
          </Link>
          {isPlatformAdmin ? (
            <>
              <Link
                href="/billing/plans"
                className="px-4 py-2 rounded-md hover:bg-neutral-800 transition text-amber-400"
              >
                Planos (Admin)
              </Link>
              <Link
                href="/providers"
                className="px-4 py-2 rounded-md hover:bg-neutral-800 transition text-emerald-400"
              >
                Provedores
              </Link>
              <Link
                href="/audit"
                className="px-4 py-2 rounded-md hover:bg-neutral-800 transition text-cyan-400"
              >
                Audit Log
              </Link>
            </>
          ) : null}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto">{children}</main>
    </div>
  );
}
