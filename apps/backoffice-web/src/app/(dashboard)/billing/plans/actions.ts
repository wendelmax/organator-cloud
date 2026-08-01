"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { revalidatePath } from "next/cache";

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function requireAdminToken() {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) throw new Error("Unauthorized");
  return token;
}

function parseJson(field: FormDataEntryValue | null, fallback: unknown) {
  if (!field || typeof field !== "string" || !field.trim()) return fallback;
  try {
    return JSON.parse(field);
  } catch {
    throw new Error(`JSON inválido: "${field}"`);
  }
}

async function errorMessage(res: Response) {
  const data = await res.json().catch(() => ({}));
  return data.message || data.error || "Falha na requisição";
}

export async function listPlans() {
  const token = await requireAdminToken();
  const res = await fetch(`${API_URL}/v1/billing/plans/all`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

export async function createPlan(formData: FormData) {
  const token = await requireAdminToken();
  const payload = {
    name: formData.get("name") as string,
    slug: formData.get("slug") as string,
    description: (formData.get("description") as string) || undefined,
    price: Math.round(Number(formData.get("priceUsd") || 0) * 100),
    currency: (formData.get("currency") as string) || "usd",
    cycle: (formData.get("cycle") as string) || "monthly",
    quotas: parseJson(formData.get("quotas"), {}),
    features: parseJson(formData.get("features"), {}),
    status: (formData.get("status") as string) || "active",
    sortOrder: Number(formData.get("sortOrder") || 0),
    syncStripe: true,
  };

  const res = await fetch(`${API_URL}/v1/billing/plans`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(await errorMessage(res));
  revalidatePath("/billing/plans");
  return { success: true };
}

export async function updatePlan(formData: FormData) {
  const token = await requireAdminToken();
  const slug = formData.get("slug") as string;
  if (!slug) throw new Error("Slug do plano é obrigatório");

  const payload = {
    name: formData.get("name") as string,
    description: (formData.get("description") as string) || undefined,
    price: Math.round(Number(formData.get("priceUsd") || 0) * 100),
    currency: (formData.get("currency") as string) || "usd",
    cycle: (formData.get("cycle") as string) || "monthly",
    quotas: parseJson(formData.get("quotas"), {}),
    features: parseJson(formData.get("features"), {}),
    status: (formData.get("status") as string) || "active",
    sortOrder: Number(formData.get("sortOrder") || 0),
    syncStripe: true,
  };

  const res = await fetch(`${API_URL}/v1/billing/plans/${slug}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(await errorMessage(res));
  revalidatePath("/billing/plans");
  return { success: true };
}

export async function togglePlan(slug: string) {
  const token = await requireAdminToken();
  const res = await fetch(`${API_URL}/v1/billing/plans/${slug}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) throw new Error(await errorMessage(res));
  revalidatePath("/billing/plans");
  return { success: true };
}
