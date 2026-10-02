"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@organator/ui";
import { useSession } from "next-auth/react";
import { publicApiUrl } from "../../../lib/public-env";

const API_URL = publicApiUrl();

/** Valor em centavos na moeda da fatura (o Stripe usa códigos ISO minúsculos). */
function formatMoney(cents: number, currency = "usd") {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export default function BillingPage() {
  const [subscription, setSubscription] = useState<any>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [targetPlan, setTargetPlan] = useState("pro");
  const { data: session } = useSession();
  const token = (session as any)?.accessToken;
  const authHeaders = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/v1/billing/subscription`, { headers: authHeaders })
      // Erro (ex.: 403 para quem não é OWNER/ADMIN/BILLING) não é assinatura.
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setSubscription(data))
      .catch(() =>
        setSubscription(null),
      );
  }, [token]);

  const handleStripePortal = async () => {
    setIsSyncing(true);
    setPortalError(null);
    try {
      const res = await fetch(`${API_URL}/v1/billing/create-portal-session`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ returnUrl: window.location.href }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        // O portal do Stripe não pode ser embutido em iframe (frame-ancestors).
        window.location.href = data.url;
        return;
      }
      setPortalError(data.message || "Não foi possível abrir o portal de cobrança.");
    } catch {
      setPortalError("Erro de rede ao abrir o portal de cobrança.");
    }
    setIsSyncing(false);
  };

  const handleUpgrade = async () => {
    const res = await fetch(`${API_URL}/v1/billing/upgrade`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        plan: targetPlan,
        returnUrl: window.location.href,
      }),
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Gestão Financeira & Faturamento
          </h1>
          <p className="text-neutral-400 mt-1">
            Gerencie planos e acesse o Stripe Customer Portal
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/billing/plans">
            <Button variant="outline">Gerenciar Planos</Button>
          </Link>
          <Button onClick={handleStripePortal} disabled={isSyncing}>
            {isSyncing ? "Sincronizando..." : "Abrir Stripe Customer Portal"}
          </Button>
          <Button onClick={() => setUpgradeOpen(true)}>Fazer upgrade</Button>
        </div>
      </div>
      {portalError && (
        <p
          role="alert"
          className="rounded-lg border border-amber-800/50 bg-amber-950/40 p-3 text-sm text-amber-300"
        >
          {portalError}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6 bg-neutral-900 border-neutral-800 shadow-xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl font-semibold text-white">
              Assinatura Atual
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center p-3 bg-neutral-950 rounded-lg border border-neutral-800">
              <span className="text-neutral-400 text-sm">Plano Ativo</span>
              <span className="font-bold text-indigo-400 text-base">
                {subscription?.plan ?? "—"}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 bg-neutral-950 rounded-lg border border-neutral-800">
              <span className="text-neutral-400 text-sm">
                Próxima renovação
              </span>
              <span className="text-white">
                {subscription?.renewalAt
                  ? new Date(subscription.renewalAt).toLocaleDateString("pt-BR")
                  : "A confirmar no Stripe"}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 bg-neutral-950 rounded-lg border border-neutral-800">
              <span className="text-neutral-400 text-sm">Preço</span>
              <span className="text-white">
                {new Intl.NumberFormat("pt-BR", {
                  style: "currency",
                  currency: (subscription?.currency || "USD").toUpperCase(),
                }).format((subscription?.price || 0) / 100)}{" "}
                / {subscription?.cycle || "monthly"}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 bg-neutral-950 rounded-lg border border-neutral-800">
              <span className="text-neutral-400 text-sm">Status da Conta</span>
              <span className="px-2.5 py-1 bg-emerald-950 text-emerald-400 border border-emerald-800/50 rounded-full text-xs font-mono font-medium">
                {subscription?.status ?? "—"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="p-6 bg-neutral-900 border-neutral-800 shadow-xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl font-semibold text-white">
              Histórico de Faturas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!subscription?.invoices || subscription.invoices.length === 0 ? (
              <p className="text-sm text-neutral-500 py-4 text-center">
                Nenhuma fatura encontrada.
              </p>
            ) : (
              subscription.invoices.map((inv: any) => (
                <div
                  key={inv.id}
                  className="flex justify-between items-center p-3 bg-neutral-950 rounded-lg border border-neutral-800 text-xs text-neutral-300 hover:border-neutral-700 transition-colors"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono font-semibold text-white">
                      {inv.id}
                    </span>
                    <span className="text-neutral-500 text-[10px]">
                      {new Date(inv.date).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-white">
                      {formatMoney(inv.amount, inv.currency)}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded border text-[10px] font-mono font-semibold uppercase ${
                        inv.status === "paid"
                          ? "bg-emerald-950 text-emerald-400 border-emerald-800/50"
                          : "bg-amber-950 text-amber-400 border-amber-800/50"
                      }`}
                    >
                      {inv.status}
                    </span>
                    {inv.url && (
                      <a
                        href={inv.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline"
                      >
                        Ver
                      </a>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {subscription?.status === "past_due" && (
        <div className="rounded-lg border border-amber-800 bg-amber-950/40 p-4 text-amber-300">
          Pagamento pendente. Atualize seu cartão no portal para evitar
          suspensão.
        </div>
      )}
      {subscription?.status === "suspended" && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 p-4 text-red-300">
          Conta suspensa por inadimplência. Regularize o pagamento para retomar
          o acesso.
        </div>
      )}
      {subscription?.entitlements && (
        <Card className="p-6 bg-neutral-900 border-neutral-800 shadow-xl">
          <CardHeader>
            <CardTitle className="text-xl font-semibold text-white">
              Uso e limites
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(subscription.entitlements.quotas || {}).map(
              ([resource, limit]: [string, any]) => {
                const used = subscription.usage?.[resource] || 0;
                const pct =
                  limit === -1
                    ? 0
                    : Math.min(
                        100,
                        Math.round((used / Math.max(1, limit)) * 100),
                      );
                const soft =
                  subscription.entitlements.limits?.[resource] === "soft";
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
                        className={`h-2 rounded ${pct >= 100 ? (soft ? "bg-amber-400" : "bg-red-500") : pct >= 80 ? (soft ? "bg-amber-400" : "bg-red-400") : "bg-indigo-500"}`}
                        style={{ width: `${limit === -1 ? 0 : pct}%` }}
                      />
                    </div>
                  </div>
                );
              },
            )}
          </CardContent>
        </Card>
      )}
      {upgradeOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70">
          <Card className="w-full max-w-md bg-neutral-900 border-neutral-700">
            <CardHeader>
              <CardTitle>Upgrade de plano</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-neutral-400">
                Selecione o plano alvo. O checkout será associado à organização
                ativa.
              </p>
              <select
                value={targetPlan}
                onChange={(event) => setTargetPlan(event.target.value)}
                className="w-full rounded border border-neutral-700 bg-neutral-950 p-3 text-white"
              >
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setUpgradeOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleUpgrade}>Continuar para checkout</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
