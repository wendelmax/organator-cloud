import { serverApiUrl } from "@/lib/public-env";

export const revalidate = 60;

type ComponentStatus = {
  component: "api" | "dashboard" | "provisioning" | "billing" | "data-plane";
  status: "operational" | "degraded" | "outage";
  activeIncidents: number;
};

type Update = {
  status: string;
  message: string;
  createdAt: string;
};

type Incident = {
  id: string;
  title: string;
  severity: "critical" | "major" | "minor";
  status: "investigating" | "identified" | "monitoring" | "resolved";
  component: ComponentStatus["component"];
  startedAt: string;
  resolvedAt: string | null;
  updates: Update[];
};

type StatusResponse = {
  overall: "operational" | "degraded" | "outage";
  components: ComponentStatus[];
  incidents: Incident[];
};

function overallLabel(overall: StatusResponse["overall"]) {
  if (overall === "outage") return "Interrupção nos sistemas";
  if (overall === "degraded") return "Sistemas degradados";
  return "Todos os sistemas operacionais";
}

function componentLabel(c: ComponentStatus["component"]) {
  const map = {
    api: "API",
    dashboard: "Dashboard",
    provisioning: "Provisioning",
    billing: "Billing",
    "data-plane": "Data Plane",
  } as const;
  return map[c];
}

function severityLabel(s: Incident["severity"]) {
  if (s === "critical") return "Crítico";
  if (s === "major") return "Maior";
  return "Menor";
}

function incidentStatusLabel(s: Incident["status"]) {
  const map = {
    investigating: "Investigando",
    identified: "Identificado",
    monitoring: "Monitorando",
    resolved: "Resolvido",
  } as const;
  return map[s];
}

function severityBadge(s: Incident["severity"]) {
  if (s === "critical") return "bg-red-600/10 text-red-600 border-red-600/20";
  if (s === "major") return "bg-orange-500/10 text-orange-600 border-orange-500/20";
  return "bg-zinc-500/10 text-zinc-600 border-zinc-500/20";
}

function statusDot(s: ComponentStatus["status"]) {
  if (s === "outage") return "bg-red-600";
  if (s === "degraded") return "bg-orange-500";
  return "bg-emerald-600";
}

function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR");
}

async function getStatus(): Promise<StatusResponse | null> {
  try {
    const base = serverApiUrl();
    const res = await fetch(`${base}/v1/status`, {
      next: { revalidate: 60 },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as StatusResponse;
  } catch {
    return null;
  }
}

export default async function StatusPage() {
  const data = await getStatus();

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
          Status da plataforma
        </h1>
        <p className="text-sm text-zinc-400">
          {data ? overallLabel(data.overall) : "Não foi possível carregar o status"}
        </p>
        {!data && (
          <p className="text-xs text-zinc-500">
            Tente novamente em instantes
          </p>
        )}
      </header>

      {data && (
        <>
          <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-sm">
            <h2 className="text-sm font-medium text-zinc-50">Componentes</h2>
            <ul className="space-y-2">
              {data.components.map((c) => (
                <li key={c.component} className="flex items-center justify-between rounded-md border border-zinc-800/70 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${statusDot(c.status)}`} />
                    <span className="text-sm text-zinc-100">{componentLabel(c.component)}</span>
                  </div>
                  <span className="text-xs text-zinc-400">
                    {c.activeIncidents > 0 ? `${c.activeIncidents} incidente${c.activeIncidents > 1 ? "s" : ""} ativo${c.activeIncidents > 1 ? "s" : ""}` : "operacional"}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-medium text-zinc-50">Incidentes</h2>
            {data.incidents.length === 0 && (
              <p className="text-sm text-zinc-400">Nenhum incidente público nos últimos 30 dias.</p>
            )}
            <ul className="space-y-3">
              {data.incidents.map((inc) => (
                <li key={inc.id} className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <h3 className="text-base font-semibold text-zinc-50">{inc.title}</h3>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${severityBadge(inc.severity)}`}>
                          {severityLabel(inc.severity)}
                        </span>
                        <span className="text-xs text-zinc-400">{componentLabel(inc.component)}</span>
                        <span className="text-xs text-zinc-400">
                          {formatDate(inc.startedAt)} → {inc.resolvedAt ? formatDate(inc.resolvedAt) : "em andamento"}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs text-zinc-400">{incidentStatusLabel(inc.status)}</span>
                  </div>
                  {inc.updates.length > 0 && (
                    <ol className="space-y-2 border-t border-zinc-800 pt-3">
                      {inc.updates.map((u, idx) => (
                        <li key={idx} className="space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-zinc-200">{incidentStatusLabel(u.status as Incident["status"])}</span>
                            <span className="text-xs text-zinc-400">{formatDate(u.createdAt)}</span>
                          </div>
                          <p className="text-sm text-zinc-300 whitespace-pre-wrap">{u.message}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
