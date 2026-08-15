"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const isPlatformAdmin = (session?.user as any)?.role === "PLATFORM_ADMIN";
  const token = (session as any)?.accessToken;
  const [tenants, setTenants] = useState<any[]>([]);
  const [switching, setSwitching] = useState(false);
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001").replace(/\/v1$/, "");
  useEffect(() => { if (token) fetch(`${apiUrl}/v1/tenants/available`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : []).then(setTenants).catch(() => setTenants([])); }, [token, apiUrl]);
  async function switchTenant(tenantId: string) { setSwitching(true); const res = await fetch(`${apiUrl}/v1/auth/switch-tenant`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ tenantId }) }); if (res.ok) { const data = await res.json(); await update({ accessToken: data.access_token, tenantId }); } setSwitching(false); }

  useEffect(() => {
    if (status === "authenticated" && (session?.user as any)?.mustChangePassword) {
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
        {tenants.length > 1 && <select disabled={switching} className="rounded bg-neutral-800 border border-neutral-700 p-2 text-sm text-white" value={(session?.user as any)?.tenantId || ""} onChange={e => switchTenant(e.target.value)}>{tenants.map(item => <option key={item.tenant.id} value={item.tenant.id}>{item.tenant.name}</option>)}</select>}
        <nav className="flex flex-col gap-2">
          <Link href="/tenants" className="px-4 py-2 rounded-md hover:bg-neutral-800 transition">Tenants</Link>
          <Link href="/services" className="px-4 py-2 rounded-md hover:bg-neutral-800 transition">Services Catalog</Link>
          <Link href="/portal" className="px-4 py-2 rounded-md hover:bg-neutral-800 transition text-blue-400">Developer Portal</Link>
          <Link href="/api-keys" className="px-4 py-2 rounded-md hover:bg-neutral-800 transition">API Keys</Link>
          <Link href="/sessions" className="px-4 py-2 rounded-md hover:bg-neutral-800 transition">Sessões</Link>
          <Link href="/settings" className="px-4 py-2 rounded-md hover:bg-neutral-800 transition">Configurações</Link>
          <Link href="/billing" className="px-4 py-2 rounded-md hover:bg-neutral-800 transition">Billing (Stripe)</Link>
          {isPlatformAdmin ? (
            <>
              <Link href="/billing/plans" className="px-4 py-2 rounded-md hover:bg-neutral-800 transition text-amber-400">Planos (Admin)</Link>
              <Link href="/providers" className="px-4 py-2 rounded-md hover:bg-neutral-800 transition text-emerald-400">Provedores</Link>
              <Link href="/audit" className="px-4 py-2 rounded-md hover:bg-neutral-800 transition text-cyan-400">Audit Log</Link>
            </>
          ) : null}
        </nav>
      </aside>
      
      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
