"use client";

import { useState, useEffect, useCallback, useTransition, FormEvent } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Button, Card, CardHeader, CardTitle, CardContent, Input } from "@organator/ui";
import { publicApiUrl } from "../../../../lib/public-env";
import {
  updateIncident,
  resolveIncident,
  addIncidentUpdate,
  addAffectedTenant,
  removeAffectedTenant,
  type ActionResult,
} from "../actions";

const API_URL = publicApiUrl();

// Espelha o model Incident + as relações retornadas por GET /v1/incidents/:id.
interface IncidentUpdateItem {
  id: string;
  status: string;
  message: string;
  internal: boolean;
  authorEmail: string | null;
  createdAt: string;
}

interface AffectedItem {
  tenantId: string;
  addedAt: string;
}

interface IncidentDetail {
  id: string;
  title: string;
  severity: string;
  status: string;
  component: string;
  public: boolean;
  assigneeEmail: string | null;
  source: string;
  alertKey: string | null;
  postmortemUrl: string | null;
  startedAt: string;
  resolvedAt: string | null;
  updatedAt: string;
  updates: IncidentUpdateItem[];
  affected: AffectedItem[];
}

// Forma achatada retornada por GET /v1/tenants (TenantsService.getTenants):
// cada item já é o tenant com users inclusos — não há envelope { tenant }.
interface TenantOption {
  id: string;
  name: string;
  slug: string;
  users?: { id: string; email: string; name?: string | null }[];
}

// Opções conforme os enums do model Incident.
const STATUSES = ["investigating", "identified", "monitoring", "resolved"];

// Rótulos PT-BR para os status (o valor enviado continua sendo o enum).
const STATUS_LABELS: Record<string, string> = {
  investigating: "Investigando",
  identified: "Identificado",
  monitoring: "Monitorando",
  resolved: "Resolvido",
};

// Cores de badge por severidade (paleta do #110, igual à listagem).
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

// Status resolvido em verde; os demais (em andamento) em âmbar.
const statusBadgeClass = (status: string) =>
  status === "resolved" ? "text-emerald-400 border-emerald-500" : "text-amber-400 border-amber-500";

const fmtDate = (iso: string) => new Date(iso).toLocaleString("pt-BR");

export function IncidentDetailClient({ incidentId }: { incidentId: string }) {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken;
  const [isPending, startTransition] = useTransition();

  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Campos editáveis do cabeçalho (sincronizados a cada reload).
  const [assigneeEmail, setAssigneeEmail] = useState("");
  const [postmortemUrl, setPostmortemUrl] = useState("");

  // Busca de tenants para o seletor do blast radius.
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [tenantsError, setTenantsError] = useState<string | null>(null);
  const [tenantQuery, setTenantQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/v1/incidents/${encodeURIComponent(incidentId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 404) throw new Error("Incidente não encontrado");
      if (!res.ok) throw new Error("Não autorizado");
      const data: IncidentDetail = await res.json();
      setIncident(data);
      setAssigneeEmail(data.assigneeEmail ?? "");
      setPostmortemUrl(data.postmortemUrl ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar o incidente");
    } finally {
      setLoading(false);
    }
  }, [token, incidentId]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  // Carrega a lista de tenants uma única vez para o seletor (busca client-side).
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/v1/tenants`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!cancelled) setTenants(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setTenantsError("Não foi possível carregar os tenants para o seletor");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Executa uma server action e recarrega o incidente em seguida.
  const runAction = (action: () => Promise<ActionResult>, successMsg: string) => {
    setActionError(null);
    setActionSuccess(null);
    startTransition(async () => {
      const outcome = await action();
      if (!outcome.success) {
        setActionError(outcome.error);
        return;
      }
      setActionSuccess(successMsg);
      await load();
    });
  };

  const handleTogglePublic = (checked: boolean) => {
    runAction(() => updateIncident(incidentId, { public: checked }), "Visibilidade atualizada.");
  };

  const handleSaveHeader = (e: FormEvent) => {
    e.preventDefault();
    // vazio vira null para limpar o campo (IsOptional do DTO aceita null).
    runAction(
      () =>
        updateIncident(incidentId, {
          assigneeEmail: assigneeEmail.trim() || null,
          postmortemUrl: postmortemUrl.trim() || null,
        }),
      "Cabeçalho atualizado.",
    );
  };

  const handleResolve = () => {
    runAction(() => resolveIncident(incidentId), "Incidente resolvido.");
  };

  // Reabrir volta o status para investigating; o servidor limpa resolvedAt.
  const handleReopen = () => {
    runAction(() => updateIncident(incidentId, { status: "investigating" }), "Incidente reaberto.");
  };

  const handleAddUpdate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    // Captura o FormData antes do reset; a action lê status/message/internal.
    const formData = new FormData(form);
    form.reset();
    runAction(() => addIncidentUpdate(incidentId, formData), "Atualização registrada.");
  };

  const handleAddTenant = (tenantId: string) => {
    setTenantQuery("");
    runAction(() => addAffectedTenant(incidentId, tenantId), "Tenant vinculado ao incidente.");
  };

  const handleRemoveTenant = (tenantId: string) => {
    runAction(() => removeAffectedTenant(incidentId, tenantId), "Tenant removido do incidente.");
  };

  const tenantName = (tenantId: string) =>
    tenants.find((t) => t.id === tenantId)?.name ?? tenantId;

  // Seletor: filtra tenants por nome/slug/e-mail de usuário (contém), já
  // excluindo os que já estão no blast radius.
  const affectedIds = new Set((incident?.affected ?? []).map((a) => a.tenantId));
  const query = tenantQuery.trim().toLowerCase();
  const tenantMatches = query
    ? tenants
        .filter((t) => !affectedIds.has(t.id))
        .filter(
          (t) =>
            t.name.toLowerCase().includes(query) ||
            t.slug.toLowerCase().includes(query) ||
            (t.users ?? []).some((u) => u.email.toLowerCase().includes(query)),
        )
        .slice(0, 6)
    : [];

  if (loading) {
    return <p className="text-neutral-500">Carregando incidente...</p>;
  }

  if (error || !incident) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-red-400">{error ?? "Incidente não encontrado"}</p>
        <Link href="/incidentes" className="inline-block text-sm text-neutral-400 hover:text-rose-300">
          ← Voltar para incidentes
        </Link>
      </div>
    );
  }

  // Linha do tempo em ordem cronológica (a API já vem asc; garante aqui também).
  const timeline = [...incident.updates].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return (
    <div className="space-y-6">
      <Link href="/incidentes" className="inline-block text-sm text-neutral-400 hover:text-rose-300">
        ← Voltar para incidentes
      </Link>

      {/* Feedback de todas as ações (cabeçalho, timeline, blast radius). */}
      {actionError && <p className="text-sm text-red-400">{actionError}</p>}
      {actionSuccess && !actionError && (
        <p className="text-sm text-emerald-400">{actionSuccess}</p>
      )}

      {/* Cabeçalho: título, badges, visibilidade, responsável, postmortem, resolver */}
      <Card className="p-4 bg-neutral-900 border-neutral-800 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">{incident.title}</h1>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono font-semibold uppercase">
              <span className={`px-2 py-0.5 rounded-full border bg-neutral-950 ${severityBadge(incident.severity)}`}>
                {incident.severity}
              </span>
              <span className={`px-2 py-0.5 rounded-full border bg-neutral-950 ${statusBadgeClass(incident.status)}`}>
                {incident.status}
              </span>
              <span className="px-2 py-0.5 rounded-full border border-neutral-700 bg-neutral-950 text-neutral-400">
                {incident.component}
              </span>
              <span
                className={`px-2 py-0.5 rounded-full border bg-neutral-950 ${
                  incident.public ? "text-sky-400 border-sky-500" : "text-neutral-500 border-neutral-700"
                }`}
              >
                {incident.public ? "público" : "interno"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {incident.status === "resolved" ? (
              <>
                <p className="text-sm text-emerald-400">
                  Resolvido em {incident.resolvedAt ? fmtDate(incident.resolvedAt) : "—"}
                </p>
                <Button variant="outline" onClick={handleReopen} disabled={isPending}>
                  Reabrir
                </Button>
              </>
            ) : (
              <Button onClick={handleResolve} disabled={isPending}>
                Resolver
              </Button>
            )}
          </div>
        </div>

        <form onSubmit={handleSaveHeader} className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            <input
              type="checkbox"
              checked={incident.public}
              onChange={(e) => handleTogglePublic(e.target.checked)}
              disabled={isPending}
              className="accent-sky-500"
            />
            Público (status page)
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            Responsável (email)
            <Input
              type="email"
              value={assigneeEmail}
              onChange={(e) => setAssigneeEmail(e.target.value)}
              placeholder="oncall@organator.app"
              disabled={isPending}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            URL do postmortem
            <Input
              type="url"
              value={postmortemUrl}
              onChange={(e) => setPostmortemUrl(e.target.value)}
              placeholder="https://..."
              disabled={isPending}
            />
          </label>
          <div className="md:col-span-3">
            <Button type="submit" variant="outline" size="sm" disabled={isPending}>
              Salvar cabeçalho
            </Button>
          </div>
        </form>
      </Card>

      {/* Linha do tempo de atualizações */}
      <Card className="bg-neutral-900 border-neutral-800 shadow-xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold text-white">Linha do tempo</CardTitle>
        </CardHeader>
        <CardContent className="p-0 pt-0 px-4 pb-4 space-y-4">
          {timeline.length === 0 ? (
            <p className="text-neutral-500 text-sm">Nenhuma atualização registrada ainda.</p>
          ) : (
            <ol className="space-y-3">
              {timeline.map((u) => (
                <li
                  key={u.id}
                  className={`border-l-2 pl-3 py-1 ${
                    u.internal ? "border-neutral-700 opacity-70" : "border-l-blue-500"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                    <span className={`px-1.5 py-0.5 rounded border font-mono uppercase ${statusBadgeClass(u.status)}`}>
                      {u.status}
                    </span>
                    {u.internal && (
                      <span className="px-1.5 py-0.5 rounded border border-neutral-600 text-neutral-500">
                        nota interna
                      </span>
                    )}
                    <span>{fmtDate(u.createdAt)}</span>
                    <span className="text-neutral-500">{u.authorEmail ?? "sistema"}</span>
                  </div>
                  <p className={`mt-1 text-sm whitespace-pre-wrap ${u.internal ? "text-neutral-500" : "text-neutral-200"}`}>
                    {u.message}
                  </p>
                </li>
              ))}
            </ol>
          )}

          {/* Formulário de nova atualização (a server action lê os campos por nome). */}
          <form onSubmit={handleAddUpdate} className="border-t border-neutral-800 pt-4 space-y-3">
            <h3 className="text-sm font-semibold text-white">Registrar atualização</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <label className="flex flex-col gap-1 text-xs text-neutral-400">
                Status
                <select
                  name="status"
                  defaultValue={incident.status === "resolved" ? "monitoring" : incident.status}
                  disabled={isPending}
                  className="rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm text-white"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-neutral-400 md:col-span-2">
                Mensagem
                <textarea
                  name="message"
                  required
                  rows={2}
                  disabled={isPending}
                  placeholder="ex.: Latência normalizada; monitorando por 30 min."
                  className="rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm text-white"
                />
              </label>
              <div className="flex flex-col justify-end gap-2">
                <label className="flex items-center gap-2 text-xs text-neutral-400">
                  <input type="checkbox" name="internal" className="accent-neutral-500" disabled={isPending} />
                  Nota interna (não aparece na status page)
                </label>
                <Button type="submit" size="sm" disabled={isPending}>
                  Adicionar
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Blast radius: tenants afetados */}
      <Card className="bg-neutral-900 border-neutral-800 shadow-xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold text-white">Blast radius (tenants afetados)</CardTitle>
        </CardHeader>
        <CardContent className="p-0 pt-0 px-4 pb-4 space-y-4">
          {incident.affected.length === 0 ? (
            <p className="text-neutral-500 text-sm">Nenhum tenant afetado registrado.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {incident.affected.map((a) => (
                <span
                  key={a.tenantId}
                  className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-700 bg-neutral-950 text-sm text-neutral-200"
                >
                  {tenantName(a.tenantId)}
                  <button
                    type="button"
                    onClick={() => handleRemoveTenant(a.tenantId)}
                    disabled={isPending}
                    aria-label={`Remover ${tenantName(a.tenantId)} do blast radius`}
                    className="text-neutral-500 hover:text-red-400"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="relative">
            <Input
              value={tenantQuery}
              onChange={(e) => setTenantQuery(e.target.value)}
              placeholder="Buscar tenant por nome ou e-mail..."
              disabled={isPending}
            />
            {tenantMatches.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 shadow-lg">
                {tenantMatches.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => handleAddTenant(t.id)}
                      className="w-full text-left px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
                    >
                      {t.name} <span className="text-neutral-500">({t.slug})</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {tenantsError && <p className="text-xs text-amber-400">{tenantsError}</p>}
        </CardContent>
      </Card>

      {/* Metadados */}
      <Card className="bg-neutral-900 border-neutral-800 shadow-xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold text-white">Metadados</CardTitle>
        </CardHeader>
        <CardContent className="p-0 pt-0 px-4 pb-4">
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div className="flex justify-between gap-4 border-b border-neutral-800 py-2">
              <dt className="text-neutral-400">Origem</dt>
              <dd className="text-neutral-200 font-mono text-xs">{incident.source}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-neutral-800 py-2">
              <dt className="text-neutral-400">Chave de alerta (alertKey)</dt>
              {/* Resolução libera a alertKey (dedup); mostre "—" quando ausente. */}
              <dd className="text-neutral-200 font-mono text-xs">{incident.alertKey ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-neutral-800 py-2">
              <dt className="text-neutral-400">Início</dt>
              <dd className="text-neutral-200">{fmtDate(incident.startedAt)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-neutral-800 py-2">
              <dt className="text-neutral-400">Resolvido em</dt>
              <dd className="text-neutral-200">{incident.resolvedAt ? fmtDate(incident.resolvedAt) : "—"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
