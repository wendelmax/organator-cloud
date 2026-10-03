"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@organator/ui";
import { publicApiUrl } from "../../../lib/public-env";
import { apiErrorMessage } from "../../../lib/api-error";

const API_URL = publicApiUrl();

interface DataExport {
  id: string;
  status: "PENDING" | "READY" | "FAILED" | "EXPIRED";
  createdAt: string;
  expiresAt: string | null;
}

const STATUS_LABEL: Record<DataExport["status"], string> = {
  PENDING: "Gerando",
  READY: "Pronto",
  FAILED: "Falhou",
  EXPIRED: "Expirado",
};

/** Exportação dos dados pessoais do próprio usuário (LGPD art. 18-V). */
export function DataExportCard() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;
  const [exports, setExports] = useState<DataExport[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${API_URL}/v1/compliance/exports`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (res?.ok) setExports(await res.json());
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function request() {
    setMessage(null);
    const res = await fetch(`${API_URL}/v1/compliance/export-request`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    setMessage(
      res.ok
        ? "Pedido registrado. O arquivo fica disponível aqui por 7 dias assim que for gerado."
        : await apiErrorMessage(res, "Não foi possível solicitar a exportação."),
    );
    await load();
  }

  // O download exige o token: busca o arquivo e entrega como blob.
  async function download(id: string) {
    const res = await fetch(`${API_URL}/v1/compliance/exports/${id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setMessage(await apiErrorMessage(res, "Não foi possível baixar o arquivo."));
      await load();
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "meus-dados.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="bg-neutral-900 border-neutral-800">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Meus dados (LGPD)</CardTitle>
        <Button size="sm" variant="outline" onClick={() => void request()}>
          Exportar meus dados
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-neutral-400">
          Gera um arquivo JSON com seu perfil, organizações, sessões, chaves de API e atividade registrada.
        </p>
        {message && (
          <p role="status" className="text-neutral-200">
            {message}
          </p>
        )}
        {exports.length > 0 && (
          <ul className="space-y-2">
            {exports.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between rounded border border-neutral-800 bg-neutral-950 p-3"
              >
                <span className="text-neutral-300">
                  {new Date(item.createdAt).toLocaleString()} · {STATUS_LABEL[item.status]}
                  {item.status === "READY" && item.expiresAt
                    ? ` · disponível até ${new Date(item.expiresAt).toLocaleDateString()}`
                    : ""}
                </span>
                {item.status === "READY" && (
                  <Button size="sm" variant="outline" onClick={() => void download(item.id)}>
                    Baixar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
