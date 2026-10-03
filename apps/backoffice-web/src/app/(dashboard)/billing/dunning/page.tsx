import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../../../lib/auth";
import { serverApiUrl } from "../../../../lib/public-env";

const API_URL = serverApiUrl();
const DAY_MS = 24 * 60 * 60 * 1000;

interface DunningCase {
  id: string;
  invoiceId: string;
  amountDue: number;
  currency: string;
  attemptCount: number;
  nextAttemptAt: string | null;
  graceEndsAt: string;
  status: string;
  tenant: { id: string; name: string; slug: string; plan: string; state: string };
}

const STATUS_FILTERS: [string, string][] = [
  ["OPEN", "Em aberto"],
  ["SUSPENDED", "Suspensos"],
  ["DOWNGRADED", "Rebaixados"],
  ["RECOVERED", "Recuperados"],
];

async function getCases(token: string, status: string): Promise<DunningCase[]> {
  const res = await fetch(`${API_URL}/v1/billing/dunning?status=${status}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return res.ok ? res.json() : [];
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

/** Risco pelo tempo de graça restante (só faz sentido para casos em aberto). */
function risk(graceEndsAt: string) {
  const daysLeft = Math.ceil((new Date(graceEndsAt).getTime() - Date.now()) / DAY_MS);
  if (daysLeft <= 0) return { label: "Graça encerrada", tone: "text-red-400" };
  if (daysLeft <= 2) return { label: `${daysLeft} dia(s) — alto`, tone: "text-red-300" };
  if (daysLeft <= 5) return { label: `${daysLeft} dias — médio`, tone: "text-amber-300" };
  return { label: `${daysLeft} dias — baixo`, tone: "text-emerald-300" };
}

/** Painel de inadimplência (#97): faturas não pagas acompanhadas pelo dunning. */
export default async function DunningPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  const token = (session as any)?.accessToken;
  if (role !== "PLATFORM_ADMIN" && role !== "SUPPORT") redirect("/billing");

  const { status: requested } = await searchParams;
  const status = STATUS_FILTERS.some(([value]) => value === requested) ? requested! : "OPEN";
  const cases = token ? await getCases(token, status) : [];
  const totals = cases.reduce<Record<string, number>>((acc, c) => {
    acc[c.currency] = (acc[c.currency] ?? 0) + c.amountDue;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Inadimplência</h1>
        <p className="text-neutral-400 mt-1">
          Faturas não pagas. As retentativas são do Stripe; a política de graça e a ação final são de cada plano.
        </p>
      </div>

      <nav className="flex gap-2 text-sm" aria-label="Filtro de status">
        {STATUS_FILTERS.map(([value, label]) => (
          <a
            key={value}
            href={`/billing/dunning?status=${value}`}
            className={`rounded-md border px-3 py-1.5 ${
              value === status ? "border-blue-500 text-white" : "border-neutral-800 text-neutral-400"
            }`}
          >
            {label}
          </a>
        ))}
      </nav>

      <p className="text-sm text-neutral-300">
        {cases.length} caso(s)
        {cases.length > 0 &&
          ` · total ${Object.entries(totals)
            .map(([currency, cents]) => money(cents, currency))
            .join(" · ")}`}
      </p>

      {cases.length === 0 ? (
        <p className="text-neutral-500">Nenhum caso neste status.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-neutral-400">
              <tr>
                <th className="px-4 py-3">Organização</th>
                <th className="px-4 py-3">Valor</th>
                <th className="px-4 py-3">Tentativas</th>
                <th className="px-4 py-3">Próxima tentativa</th>
                <th className="px-4 py-3">Fim da graça</th>
                <th className="px-4 py-3">{status === "OPEN" ? "Risco" : "Estado"}</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => {
                const r = risk(c.graceEndsAt);
                return (
                  <tr key={c.id} className="border-t border-neutral-800 text-neutral-200">
                    <td className="px-4 py-3">
                      {c.tenant.name}
                      <span className="block text-xs text-neutral-500">
                        {c.tenant.slug} · {c.tenant.plan}
                      </span>
                    </td>
                    <td className="px-4 py-3">{money(c.amountDue, c.currency)}</td>
                    <td className="px-4 py-3">{c.attemptCount}</td>
                    <td className="px-4 py-3">
                      {c.nextAttemptAt ? new Date(c.nextAttemptAt).toLocaleDateString("pt-BR") : "—"}
                    </td>
                    <td className="px-4 py-3">{new Date(c.graceEndsAt).toLocaleDateString("pt-BR")}</td>
                    <td className={`px-4 py-3 ${status === "OPEN" ? r.tone : "text-neutral-400"}`}>
                      {status === "OPEN" ? r.label : c.tenant.state}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
