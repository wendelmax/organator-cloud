"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { publicApiUrl } from "../../lib/public-env";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const isPlatformAdmin = (session?.user as any)?.role === "PLATFORM_ADMIN";
  const impersonatedBy = (session?.user as any)?.impersonatedBy as string | undefined;

  // Encerra a sessão de suporte na API (revoga e audita) e volta ao login.
  async function endSupportSession() {
    await fetch(`${publicApiUrl()}/v1/auth/impersonate/stop`, {
      method: "POST",
      headers: { Authorization: `Bearer ${(session as any)?.accessToken}` },
    }).catch(() => undefined);
    await signOut({ callbackUrl: "/login" });
  }
  const token = (session as any)?.accessToken;
  const [tenants, setTenants] = useState<any[]>([]);
  const [switching, setSwitching] = useState(false);
  const [tenantSearch, setTenantSearch] = useState("");
  const apiUrl = publicApiUrl();
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
      await update({ accessToken: data.access_token });
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

  // Termos/privacidade sem aceite na versão vigente: pede o consentimento antes
  // de liberar o painel (depois da troca de senha obrigatória, se houver).
  useEffect(() => {
    if (status !== "authenticated" || !token) return;
    if ((session?.user as any)?.mustChangePassword) return;
    // Suporte não aceita termos em nome do usuário (a API bloqueia).
    if ((session?.user as any)?.impersonatedBy) return;
    fetch(`${apiUrl}/v1/compliance/consents`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((consents) => {
        if (consents?.required?.length) {
          router.replace(
            `/consent?next=${encodeURIComponent(window.location.pathname)}`,
          );
        }
      })
      .catch(() => undefined);
  }, [status, session, token, apiUrl, router]);

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
      <main className="flex-1 p-8 overflow-y-auto">
        {impersonatedBy && (
          <div
            role="alert"
            className="mb-6 flex flex-col gap-3 rounded-lg border border-amber-600 bg-amber-950/60 p-4 text-sm text-amber-100 md:flex-row md:items-center md:justify-between"
          >
            <span>
              <strong>Sessão de suporte:</strong> você está acessando como{" "}
              <strong>{(session?.user as any)?.actingAs}</strong> (por {impersonatedBy}). Tudo o que
              fizer fica registrado na auditoria.
            </span>
            <button
              type="button"
              onClick={() => void endSupportSession()}
              className="rounded-md border border-amber-500 px-3 py-1.5 font-medium hover:bg-amber-900"
            >
              Encerrar sessão de suporte
            </button>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
