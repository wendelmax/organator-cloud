import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../../../lib/auth";
import { PlansClient } from "./ClientPage";

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function getPlans(token: string) {
  const res = await fetch(`${API_URL}/v1/billing/plans/all`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

export default async function BillingPlansPage() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  const token = (session as any)?.accessToken;

  if (role !== "PLATFORM_ADMIN") {
    redirect("/billing");
  }

  const plans = token ? await getPlans(token) : [];
  return <PlansClient initialPlans={plans} />;
}
