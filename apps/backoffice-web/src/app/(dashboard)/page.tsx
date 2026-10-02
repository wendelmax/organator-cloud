"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { publicApiUrl } from "../../lib/public-env";

const API_URL = publicApiUrl();

export default function DashboardHome() {
  const { data: session } = useSession();
  const params = useParams<{ slug?: string }>();
  const token = (session as any)?.accessToken;
  const [subscription, setSubscription] = useState<any>(null);
  const [tenantCount, setTenantCount] = useState<number | null>(null);
  const isPlatformAdmin = (session?.user as any)?.role === "PLATFORM_ADMIN";
  const billingHref = params?.slug ? `/org/${params.slug}/billing` : "/billing";

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/v1/billing/subscription`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then(setSubscription)
      .catch(() => setSubscription(null));
  }, [token]);

  // Total de tenants só faz sentido (e só é permitido) para o admin da plataforma.
  useEffect(() => {
    if (!token || !isPlatformAdmin) return;
    fetch(`${API_URL}/v1/tenants`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => (response.ok ? response.json() : null))
      .then((tenants) => setTenantCount(Array.isArray(tenants) ? tenants.length : null))
      .catch(() => setTenantCount(null));
  }, [token, isPlatformAdmin]);

  // Antes: "12 tenants", "8 microsserviços" e "R$ 14.500" fixos para todos.
  const usage = subscription?.usage ?? {};
  const stats: { label: string; value: number | null | undefined; color: string }[] = [
    ...(isPlatformAdmin ? [{ label: "Total de Tenants", value: tenantCount, color: "text-blue-400" }] : []),
    { label: "Microsserviços", value: subscription ? usage.MICROSERVICE : null, color: "text-purple-400" },
    { label: "Deploys", value: subscription ? usage.DEPLOYMENT : null, color: "text-green-400" },
    { label: "Membros", value: subscription ? usage.SEATS : null, color: "text-amber-400" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      <p className="text-neutral-400">
        Visão geral do seu SaaS e Infraestrutura.
      </p>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="p-6 bg-neutral-900 border border-neutral-800 rounded-xl">
            <h2 className="text-lg font-semibold text-neutral-300">{stat.label}</h2>
            <p className={`mt-2 text-4xl font-bold ${stat.color}`}>{stat.value ?? "—"}</p>
          </div>
        ))}
      </div>

      {subscription && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-neutral-400">Plano atual</p>
              <p className="text-2xl font-bold text-indigo-400">
                {subscription.plan}
              </p>
              <p className="text-sm text-neutral-300">
                {new Intl.NumberFormat("pt-BR", {
                  style: "currency",
                  currency: (subscription.currency || "USD").toUpperCase(),
                }).format((subscription.price || 0) / 100)}{" "}
                / {subscription.cycle || "monthly"} · {subscription.status}
              </p>
            </div>
            <Link
              href={billingHref}
              className="rounded-md bg-indigo-600 px-4 py-2 text-center font-medium hover:bg-indigo-500"
            >
              Gerenciar assinatura
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {Object.entries(subscription.entitlements?.quotas || {}).map(
              ([resource, rawLimit]) => {
                const limit = Number(rawLimit);
                const used = Number(subscription.usage?.[resource] || 0);
                const percentage =
                  limit === -1
                    ? 0
                    : Math.min(
                        100,
                        Math.round((used / Math.max(1, limit)) * 100),
                      );
                const soft =
                  subscription.entitlements?.limits?.[resource] === "soft";
                return (
                  <div key={resource} className="space-y-1">
                    <div className="flex justify-between text-sm text-neutral-300">
                      <span>{resource}</span>
                      <span>
                        {used} / {limit === -1 ? "∞" : limit}
                      </span>
                    </div>
                    <div className="h-2 rounded bg-neutral-800">
                      <div
                        className={`h-2 rounded ${percentage >= 100 ? (soft ? "bg-amber-400" : "bg-red-500") : "bg-indigo-500"}`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              },
            )}
          </div>
        </div>
      )}
    </div>
  );
}
