"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@organator/ui";
import { publicApiUrl } from "../../../../lib/public-env";
import { apiErrorMessage } from "../../../../lib/api-error";

interface Coupon {
  id: string;
  code: string;
  percentOff: number | null;
  amountOff: number | null;
  currency: string;
  duration: string;
  maxRedemptions: number | null;
  redeemedCount: number;
  expiresAt: string | null;
  active: boolean;
  planSlugs: string[];
}

const describe = (c: Coupon) =>
  c.percentOff !== null ? `${c.percentOff}%` : `${(c.amountOff! / 100).toFixed(2)} ${c.currency.toUpperCase()}`;

/** Gestão de cupons de desconto (admin da plataforma, #95). */
export function CouponsCard() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [form, setForm] = useState({ code: "", percentOff: "", maxRedemptions: "", expiresAt: "", planSlugs: "" });
  const [message, setMessage] = useState<string | null>(null);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${publicApiUrl()}/v1/billing/coupons`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (res?.ok) setCoupons(await res.json());
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setMessage(null);
    const res = await fetch(`${publicApiUrl()}/v1/billing/coupons`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        code: form.code,
        percentOff: Number(form.percentOff),
        maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        planSlugs: form.planSlugs
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
      }),
    });
    if (!res.ok) {
      setMessage(await apiErrorMessage(res, "Não foi possível criar o cupom."));
      return;
    }
    setForm({ code: "", percentOff: "", maxRedemptions: "", expiresAt: "", planSlugs: "" });
    setMessage("Cupom criado.");
    await load();
  }

  async function deactivate(code: string) {
    // Sem corpo: não enviar Content-Type JSON (o Fastify recusa corpo vazio).
    const res = await fetch(`${publicApiUrl()}/v1/billing/coupons/${encodeURIComponent(code)}/deactivate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    setMessage(res.ok ? `Cupom ${code} desativado.` : await apiErrorMessage(res, "Não foi possível desativar o cupom."));
    await load();
  }

  return (
    <Card className="bg-neutral-900 border-neutral-800">
      <CardHeader>
        <CardTitle>Cupons</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <Input aria-label="Código do cupom" placeholder="Código (ex.: LANCAMENTO20)" value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <Input aria-label="Desconto (%)" type="number" placeholder="Desconto %" value={form.percentOff}
            onChange={(e) => setForm({ ...form, percentOff: e.target.value })} />
          <Input aria-label="Máximo de usos" type="number" placeholder="Máx. usos (opcional)" value={form.maxRedemptions}
            onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })} />
          <Input aria-label="Validade" type="date" value={form.expiresAt}
            onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
          <Input aria-label="Planos" placeholder="Planos (ex.: pro) — vazio = todos" value={form.planSlugs}
            onChange={(e) => setForm({ ...form, planSlugs: e.target.value })} />
        </div>
        <Button onClick={() => void create()} disabled={!form.code || !form.percentOff}>
          Criar cupom
        </Button>
        {message && <p role="status" className="text-neutral-200">{message}</p>}
        <ul className="space-y-2">
          {coupons.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded border border-neutral-800 bg-neutral-950 p-3">
              <span className={c.active ? "text-neutral-200" : "text-neutral-500 line-through"}>
                <strong>{c.code}</strong> · {describe(c)} · {c.redeemedCount}
                {c.maxRedemptions ? `/${c.maxRedemptions}` : ""} uso(s)
                {c.planSlugs?.length ? ` · ${c.planSlugs.join(", ")}` : ""}
                {c.expiresAt ? ` · até ${new Date(c.expiresAt).toLocaleDateString()}` : ""}
              </span>
              {c.active && (
                <Button size="sm" variant="outline" onClick={() => void deactivate(c.code)}>
                  Desativar
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
