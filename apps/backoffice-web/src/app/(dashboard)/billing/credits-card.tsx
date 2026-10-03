"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@organator/ui";
import { publicApiUrl } from "../../../lib/public-env";

interface CreditEntry {
  id: string;
  kind: "GRANT" | "REVERSAL";
  amount: number;
  currency: string;
  reason: string;
  createdAt: string;
  reversed?: boolean;
}

const money = (cents: number, currency: string) => {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency.toUpperCase() }).format(
      cents / 100,
    );
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
};

/** Saldo e extrato de créditos de cortesia do tenant (#95). */
export function CreditsCard() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;
  const [statement, setStatement] = useState<{
    balance: Record<string, number>;
    entries: CreditEntry[];
  } | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`${publicApiUrl()}/v1/billing/credits`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then(setStatement)
      .catch(() => setStatement(null));
  }, [token]);

  // Sem lançamentos não há o que mostrar (nem permissão: MEMBER não vê billing).
  if (!statement || statement.entries.length === 0) return null;

  return (
    <Card className="bg-neutral-900 border-neutral-800">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Créditos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-neutral-300">
          Saldo:{" "}
          {Object.entries(statement.balance)
            .map(([currency, cents]) => money(cents, currency))
            .join(" · ")}{" "}
          <span className="text-neutral-500">— abatido automaticamente das próximas faturas</span>
        </p>
        <ul className="space-y-2">
          {statement.entries.map((entry) => (
            <li
              key={entry.id}
              className="flex justify-between gap-3 rounded border border-neutral-800 bg-neutral-950 p-3 text-xs"
            >
              <span className="text-neutral-300">
                {new Date(entry.createdAt).toLocaleDateString()} · {entry.kind === "GRANT" ? "Crédito" : "Estorno"}:{" "}
                {entry.reason}
                {entry.reversed ? " (estornado)" : ""}
              </span>
              <span className={entry.amount >= 0 ? "text-emerald-400" : "text-red-400"}>
                {money(entry.amount, entry.currency)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
