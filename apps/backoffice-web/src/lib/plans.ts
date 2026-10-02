export interface PublicPlan {
  slug: string;
  name: string;
  description?: string | null;
  price: number; // centavos
  currency: string;
  cycle: string; // monthly | yearly
  quotas?: Record<string, number> | null;
}

/** Preço do plano na moeda dele, ex.: "US$ 49,00/mês". */
export function formatPlanPrice(plan: Pick<PublicPlan, "price" | "currency" | "cycle">, locale = "pt-BR"): string {
  const amount = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: (plan.currency || "usd").toUpperCase(),
  }).format((plan.price || 0) / 100);
  return `${amount}/${plan.cycle === "yearly" ? "ano" : "mês"}`;
}

const QUOTA_LABELS: Record<string, [string, string]> = {
  MICROSERVICE: ["microsserviço", "microsserviços"],
  DEPLOYMENT: ["deploy/mês", "deploys/mês"],
  SEATS: ["membro", "membros"],
  DOMAINS: ["domínio", "domínios"],
};

/** Limites do plano em texto (-1 = ilimitado), na ordem de QUOTA_LABELS. */
export function planHighlights(quotas: Record<string, number> | null | undefined): string[] {
  if (!quotas) return [];
  return Object.entries(QUOTA_LABELS)
    .filter(([resource]) => typeof quotas[resource] === "number")
    .map(([resource, [one, many]]) => {
      const limit = quotas[resource];
      if (limit === -1) return `${many.replace("/mês", "")} ilimitados`;
      return `${limit} ${limit === 1 ? one : many}`;
    });
}
