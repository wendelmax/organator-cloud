"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Card, CardHeader, CardTitle, CardContent, Button } from "@organator/ui";
import { publicApiUrl } from "../../../lib/public-env";
import { apiErrorMessage } from "../../../lib/api-error";

const API_URL = publicApiUrl();

interface Environment {
  id: string;
  name: string;
  type: string;
  isPromoted?: boolean;
  envVars?: Record<string, unknown> | null;
}

/** Ambientes do tenant e promoção das variáveis de staging para produção. */
export function EnvironmentsCard({ tenantId }: { tenantId: string }) {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;
  const [environments, setEnvironments] = useState<Environment[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${API_URL}/v1/tenants/${tenantId}/environments`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (!res?.ok) {
      setMessage("Não foi possível carregar os ambientes.");
      return;
    }
    setEnvironments(await res.json());
  }, [tenantId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const staging = environments?.find((env) => env.type === "STAGING");

  async function promote() {
    if (!staging || !token) return;
    setBusy(true);
    const res = await fetch(`${API_URL}/v1/tenants/${tenantId}/environments/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sourceEnvId: staging.id }),
    });
    setBusy(false);
    setMessage(
      res.ok
        ? "Promoção enfileirada: as variáveis de staging serão copiadas para produção."
        : await apiErrorMessage(res, "Não foi possível promover o ambiente."),
    );
  }

  return (
    <Card className="bg-neutral-900 border-neutral-800 text-xs text-neutral-200 mt-6">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold">Ambientes da Organização</CardTitle>
        <Button
          size="sm"
          variant="outline"
          disabled={!staging || busy}
          title={staging ? undefined : "Nenhum ambiente de staging cadastrado"}
          onClick={() => void promote()}
        >
          Promover Staging → Produção
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {message && <p role="status" className="text-neutral-300">{message}</p>}
        {environments === null ? (
          <p className="text-neutral-500">Carregando...</p>
        ) : environments.length === 0 ? (
          <p className="text-neutral-500">Nenhum ambiente cadastrado para este tenant.</p>
        ) : (
          environments.map((env) => (
            <div
              key={env.id}
              className="flex items-center justify-between border-b border-neutral-800 pb-2 last:border-0"
            >
              <span>
                {env.name} <span className="text-neutral-500">({env.type})</span>
              </span>
              <span className="font-mono text-neutral-400">
                {Object.keys(env.envVars ?? {}).length} variável(is)
                {env.isPromoted ? " · promovido" : ""}
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
