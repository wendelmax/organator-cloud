"use client";

import { useState, useEffect } from "react";
import { Button, Card, CardHeader, CardTitle, CardContent } from "@organator/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function BillingPage() {
  const [subscription, setSubscription] = useState<any>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/v1/billing/subscription`)
      .then((res) => res.json())
      .then((data) => setSubscription(data))
      .catch(() => setSubscription({ plan: "Pro", status: "active", invoices: [] }));
  }, []);

  const handleStripePortal = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(`${API_URL}/v1/billing/create-portal-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnUrl: window.location.href }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      alert("Erro ao redirecionar para o Stripe Portal");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Gestão Financeira & Faturamento</h1>
          <p className="text-neutral-400 mt-1">Gerencie planos e acesse o Stripe Customer Portal</p>
        </div>
        <Button onClick={handleStripePortal} disabled={isSyncing}>
          {isSyncing ? "Sincronizando..." : "Abrir Stripe Customer Portal"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6 bg-neutral-900 border-neutral-800 shadow-xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl font-semibold text-white">Assinatura Atual</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center p-3 bg-neutral-950 rounded-lg border border-neutral-800">
              <span className="text-neutral-400 text-sm">Plano Ativo</span>
              <span className="font-bold text-indigo-400 text-base">{subscription?.plan || "Pro"}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-neutral-950 rounded-lg border border-neutral-800">
              <span className="text-neutral-400 text-sm">Status da Conta</span>
              <span className="px-2.5 py-1 bg-emerald-950 text-emerald-400 border border-emerald-800/50 rounded-full text-xs font-mono font-medium">
                {subscription?.status || "ativo"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="p-6 bg-neutral-900 border-neutral-800 shadow-xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl font-semibold text-white">Histórico de Faturas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!subscription?.invoices || subscription.invoices.length === 0 ? (
              <p className="text-sm text-neutral-500 py-4 text-center">Nenhuma fatura encontrada.</p>
            ) : (
              subscription.invoices.map((inv: any) => (
                <div key={inv.id} className="flex justify-between items-center p-3 bg-neutral-950 rounded-lg border border-neutral-800 text-xs text-neutral-300 hover:border-neutral-700 transition-colors">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono font-semibold text-white">{inv.id}</span>
                    <span className="text-neutral-500 text-[10px]">{new Date(inv.date || '2026-07-31').toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-white">${(inv.amount / 100).toFixed(2)} USD</span>
                    <span className="px-2 py-0.5 bg-emerald-950 text-emerald-400 border border-emerald-800/50 rounded text-[10px] font-mono font-semibold uppercase">
                      {inv.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
