"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@organator/ui";
import { publicApiUrl } from "../../../lib/public-env";
import { apiErrorMessage } from "../../../lib/api-error";

const API_URL = publicApiUrl();

interface ConsentStatus {
  versions: { terms: string; privacy: string };
  preferences: { marketing: boolean; analytics: boolean };
  consents: { purpose: string; version: string; grantedAt: string }[];
}

const OPTIONAL: ["marketing" | "analytics", string][] = [
  ["marketing", "Novidades e comunicações de marketing por e-mail"],
  ["analytics", "Métricas de uso para melhorar o produto"],
];

/** Centro de preferências de privacidade do usuário (#107). */
export function PrivacyCard() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;
  const [status, setStatus] = useState<ConsentStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${API_URL}/v1/compliance/consents`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (res?.ok) setStatus(await res.json());
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!status) return null;

  async function toggle(purpose: string, granted: boolean) {
    setMessage(null);
    const res = await fetch(`${API_URL}/v1/compliance/consents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ purpose, granted }),
    });
    if (res.ok) {
      setStatus(await res.json());
      setMessage(granted ? "Preferência ativada." : "Preferência desativada: vale a partir de agora.");
    } else {
      setMessage(await apiErrorMessage(res, "Não foi possível salvar a preferência."));
    }
  }

  const accepted = (purpose: string) => status.consents.find((c) => c.purpose === purpose);

  return (
    <Card className="bg-neutral-900 border-neutral-800">
      <CardHeader>
        <CardTitle>Privacidade</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-2">
          {OPTIONAL.map(([purpose, label]) => (
            <label key={purpose} className="flex items-center gap-3 text-neutral-200">
              <input
                type="checkbox"
                aria-label={label}
                checked={status.preferences[purpose]}
                onChange={(e) => void toggle(purpose, e.target.checked)}
              />
              {label}
            </label>
          ))}
        </div>
        <ul className="text-neutral-400 space-y-1">
          {(["terms", "privacy"] as const).map((purpose) => {
            const consent = accepted(purpose);
            return (
              <li key={purpose}>
                {purpose === "terms" ? "Termos de uso" : "Política de privacidade"}:{" "}
                {consent
                  ? `versão ${consent.version}, aceita em ${new Date(consent.grantedAt).toLocaleDateString()}`
                  : "pendente"}
              </li>
            );
          })}
        </ul>
        {message && (
          <p role="status" className="text-neutral-200">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
