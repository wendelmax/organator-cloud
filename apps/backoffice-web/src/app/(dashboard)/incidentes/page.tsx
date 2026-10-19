"use client";

import { useState, useEffect, useCallback, useTransition, FormEvent } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Button, Card, CardHeader, CardTitle, CardContent, Input } from "@organator/ui";
import { publicApiUrl } from "../../../lib/public-env";
import { createIncident } from "./actions";

const API_URL = publicApiUrl();

// Espelha o model Incident (schema.prisma); a API lista sem a relação de updates.
interface IncidentRow {
  id: string;
  title: string;
  severity: string;
  status: string;
  component: string;
  public: boolean;
  assigneeEmail: string | null;
  startedAt: string;
  resolvedAt: string | null;
  updatedAt: string;
  // Contagem de updates, quando a API incluir (defensivo: mostra "—" se ausente).
  _count?: { updates?: number };
  updates?: unknown[];
}

interface IncidentsPage {
  items: IncidentRow[];
  total: number;
  page: number;
  pages: number;
}

// Opções conforme os enums do model Incident.
const SEVERITIES = ["critical", "major", "minor"];
const STATUSES = ["investigating", "identified", "monitoring", "resolved"];
const COMPONENTS = ["api", "dashboard", "provisioning", "billing", "data-plane"];

// Cores de badge por severidade (paleta do #110).
const severityBadge = (severity: string) => {
  switch (severity) {
    case "critical":
      return "text-red-400 border-red-500";
    case "major":
      return "text-orange-400 border-orange-500";
    default:
      return "text-neutral-400";
  }
};

export default function IncidentsPage() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken;

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [component, setComponent] = useState("");

  const [result, setResult] = useState<IncidentsPage>({ items: [], total: 0, page: 1, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Formulário "Novo incidente" via server action (Task 3).
  const [severityForm, setSeverityForm] = useState("minor");
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(p), limit: "25" });
        if (status.trim()) params.set("status", status.trim());
        if (severity.trim()) params.set("severity", severity.trim());
        if (component.trim()) params.set("component", component.trim());

        const res = await fetch(`${API_URL}/v1/incidents?${params.toString()}`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) throw new Error("Não autorizado");
        setResult(await res.json());
      } catch {
        setError("Não foi possível carregar os incidentes");
      } finally {
        setLoading(false);
      }
    },
    [token, status, severity, component],
  );

  useEffect(() => {
    if (token) {
      load(page);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, page]);

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    setPage(1);
    load(1);
  };

  // Contagem de updates: usa o campo presente (relação da API ou _count); "—" caso contrário.
  const updatesCount = (row: IncidentRow) => {
    if (typeof row?._count?.updates === "number") return String(row._count.updates);
    if (Array.isArray(row?.updates)) return String(row.updates.length);
    return "—";
  };

  const handleCreate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    setFormError(null);
    setFormSuccess(false);
    startTransition(async () => {
      const outcome = await createIncident(formData);
      if (!outcome.success) {
        setFormError(outcome.error);
        return;
      }
      form.reset();
      setSeverityForm("minor");
      setFormSuccess(true);
      // No fetch duplo: se já estamos na página 1, carregamos direto;
      // senão a troca de página (effect) refaz a lista.
      if (page === 1) {
        await load(1);
      } else {
        setPage(1);
      }
    });
  };

  // Incidentes ainda abertos (não resolvidos) para o banner de alerta.
  const openIncidents = result.items.filter((i) => i.status !== "resolved").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Incidentes</h1>
        <p className="text-neutral-400 mt-1">Histórico operacional de incidentes da plataforma</p>
      </div>

      {/* Banner de incidentes em aberto (nesta página) */}
      {openIncidents > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-amber-600 bg-amber-950/60 p-4 text-sm text-amber-100"
        >
          <strong>{openIncidents} incidente(s) em aberto</strong> nesta listagem — acompanhe os
          detalhes e registre atualizações.
        </div>
      )}

      <Card className="p-4 bg-neutral-900 border-neutral-800 shadow-xl">
        <form onSubmit={handleSearch} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm text-white"
            >
              <option value="">Todos</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            Severidade
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm text-white"
            >
              <option value="">Todas</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            Componente
            <select
              value={component}
              onChange={(e) => setComponent(e.target.value)}
              className="rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm text-white"
            >
              <option value="">Todos</option>
              {COMPONENTS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button type="submit" className="w-full">Filtrar</Button>
          </div>
        </form>
      </Card>

      <Card className="p-4 bg-neutral-900 border-neutral-800 shadow-xl">
        <CardHeader className="pb-3 p-0">
          <CardTitle className="text-lg font-semibold text-white">Novo incidente</CardTitle>
        </CardHeader>
        <CardContent className="p-0 pt-3">
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              Título
              <Input name="title" required placeholder="ex.: Latência alta na API" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              Severidade
              <select
                name="severity"
                value={severityForm}
                onChange={(e) => setSeverityForm(e.target.value)}
                className="rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm text-white"
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              Componente
              <select
                name="component"
                defaultValue="api"
                className="rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm text-white"
              >
                {COMPONENTS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              Responsável (email)
              <Input name="assigneeEmail" type="email" placeholder="oncall@organator.app" />
            </label>
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 text-xs text-neutral-400 pb-2">
                <input type="checkbox" name="public" defaultChecked className="accent-rose-500" />
                Público
              </label>
              <Button type="submit" disabled={isPending} className="flex-1">
                {isPending ? "Abrindo..." : "Abrir incidente"}
              </Button>
            </div>
          </form>
          {formError && <p className="text-sm text-red-400 mt-3">{formError}</p>}
          {formSuccess && !formError && (
            <p className="text-sm text-emerald-400 mt-3">Incidente aberto com sucesso.</p>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Card className="bg-neutral-900 border-neutral-800 shadow-xl overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold text-white">
            {result.total} incidente(s)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-4 text-neutral-500">Carregando...</p>
          ) : result.items.length === 0 ? (
            <p className="p-4 text-neutral-500">Nenhum incidente encontrado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wider text-neutral-400">
                    <th className="px-4 py-2">Título</th>
                    <th className="px-4 py-2">Severidade</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Componente</th>
                    <th className="px-4 py-2">Responsável</th>
                    <th className="px-4 py-2">Updates</th>
                    <th className="px-4 py-2">Início</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((row) => (
                    <tr key={row.id} className="border-b border-neutral-800/50 hover:bg-neutral-800/40">
                      <td className="px-4 py-2">
                        <Link
                          href={`/incidentes/${row.id}`}
                          className="text-neutral-100 hover:text-rose-300 font-medium"
                        >
                          {row.title}
                        </Link>
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`px-2 py-0.5 rounded-full border bg-neutral-900 text-xs font-mono font-semibold uppercase ${severityBadge(
                            row.severity,
                          )}`}
                        >
                          {row.severity}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-neutral-300">
                        {row.status === "resolved" ? (
                          <span className="text-emerald-400">{row.status}</span>
                        ) : (
                          <span className="text-amber-400">{row.status}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-neutral-400 font-mono text-xs">{row.component}</td>
                      <td className="px-4 py-2 text-neutral-300">{row.assigneeEmail || "—"}</td>
                      <td className="px-4 py-2 text-neutral-300">{updatesCount(row)}</td>
                      <td className="px-4 py-2 text-neutral-300 whitespace-nowrap">
                        {new Date(row.startedAt).toLocaleString("pt-BR")}
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
