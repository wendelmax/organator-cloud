"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { revalidatePath } from "next/cache";
import { serverApiUrl } from "../../../lib/public-env";

const API_URL = serverApiUrl();

export async function createService(formData: FormData) {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;

  if (!token) throw new Error("Unauthorized");

  // O tenant vem da sessão na API; só os campos do serviço vão no corpo.
  const payload = {
    name: formData.get("name"),
    cloudProvider: formData.get("cloudProvider"),
    repositoryUrl: formData.get("repository") || formData.get("repositoryUrl"),
    image: formData.get("image") || undefined,
    vpsHost: formData.get("vpsHost") || undefined,
  };

  const res = await fetch(`${API_URL}/v1/services`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error("Failed to create service");
  }

  revalidatePath("/services");
  return { success: true };
}

export type DeployResult =
  | { success: true; deployment: { id: string; status: string; logs: string | null; createdAt: string } }
  | { success: false; error: string };

/** Inicia um deploy do serviço (POST /v1/services/:id/deploy). */
export async function triggerDeploy(serviceId: string, environment = "production"): Promise<DeployResult> {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) return { success: false, error: "Sessão expirada. Entre novamente." };

  const res = await fetch(`${API_URL}/v1/services/${encodeURIComponent(serviceId)}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ environment }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Ex.: cota de deploys do plano esgotada (403) ou serviço inexistente (404).
    return { success: false, error: data.message || "Não foi possível iniciar o deploy." };
  }

  revalidatePath(`/services/${serviceId}`);
  return { success: true, deployment: data };
}
