"use client";

import { useState, useEffect, useCallback, FormEvent } from "react";
import { useSession } from "next-auth/react";
import { Button, Card, CardHeader, CardTitle, CardContent, Input } from "@organator/ui";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001").replace(/\/v1$/, "");

interface AuditRow {
  id: string;
  actorEmail: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  changes: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

interface AuditPage {
  items: AuditRow[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export default function AuditLogPage() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken;

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [action, setAction] = useState("");
  const [actorEmail, setActorEmail] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [result, setResult] = useState<AuditPage>({ items: [], total: 0, page: 1, limit: 25, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (p: number, limitValue: number) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(p), limit: String(limitValue) });
        if (action.trim()) params.set("action", action.trim());
        if (actorEmail.trim()) params.set("actorEmail", actorEmail.trim());
        if (from) params.set("from", new Date(from).toISOString());
        if (to) params.set("to", new Date(`${to}T23:59:59`).toISOString());

        const res = await fetch(`${API_URL}/v1/audit-logs?${params.toString()}`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) throw new Error("Não autorizado");
        setResult(await res.json());
      } catch {
        setError("Não foi possível carregar o histórico de auditoria");
      } finally {
        setLoading(false);
      }
    },
    [token, action, actorEmail, from, to],
  );

  useEffect(() => {
    if (token) {
      load(page, limit);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, page, limit]);

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    setPage(1);
    load(1, limit);
  };

  const changesSummary = (changes: Record<string, unknown>) => {
    try {
      return JSON.stringify(changes);
    } catch {
      return "{}";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Audit Log</h1>
        <p className="text-neutral-400 mt-1">Histórico de ações administrativas (somente leitura)</p>
      </div>

      <Card className="p-4 bg-neutral-900 border-neutral-800 shadow-xl">
        <form onSubmit={handleSearch} className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            Ação
            <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="ex.: tenant.created" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            Ator (email)
            <Input value={actorEmail} onChange={(e) => setActorEmail(e.target.value)} placeholder="admin@organator.app" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            De
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            Até
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <div className="flex items-end">
            <Button type="submit" className="w-full">Filtrar</Button>
          </div>
        </form>
      </Card>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Card className="bg-neutral-900 border-neutral-800 shadow-xl overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold text-white">
            {result.total} registro(s)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-4 text-neutral-500">Carregando...</p>
          ) : result.items.length === 0 ? (
            <p className="p-4 text-neutral-500">Nenhum registro encontrado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wider text-neutral-400">
                    <th className="px-4 py-2">Data</th>
                    <th className="px-4 py-2">Ator</th>
                    <th className="px-4 py-2">Ação</th>
                    <th className="px-4 py-2">Recurso</th>
                    <th className="px-4 py-2">IP</th>
                    <th className="px-4 py-2">Mudanças</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((row) => (
                    <tr key={row.id} className="border-b border-neutral-800/50 align-top">
                      <td className="px-4 py-2 text-neutral-300 whitespace-nowrap">
                        {new Date(row.createdAt).toLocaleString("pt-BR")}
                      </td>
                      <td className="px-4 py-2 text-neutral-200">{row.actorEmail || "—"}</td>
                      <td className="px-4 py-2">
                        <span className="px-2 py-0.5 bg-indigo-950 text-indigo-300 border border-indigo-800/50 rounded-full text-xs font-mono">
                          {row.action}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-neutral-300">
                        <span className="text-neutral-200">{row.resourceType}</span>
                        {row.resourceId ? (
                          <span className="block text-neutral-500 text-xs font-mono">{row.resourceId}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-neutral-500 font-mono text-xs">{row.ip || "—"}</td>
                      <td className="px-4 py-2 text-neutral-400 text-xs font-mono break-all">
                        {changesSummary(row.changes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-500">
          Página {result.page} de {result.pages}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={result.page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Anterior
          </Button>
          <Button variant="outline" size="sm" disabled={result.page >= result.pages || loading} onClick={() => setPage((p) => p + 1)}>
            Próxima
          </Button>
        </div>
      </div>
    </div>
  );
}
