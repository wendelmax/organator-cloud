"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { revalidatePath } from "next/cache";
import { serverApiUrl } from "../../../lib/public-env";
import { apiErrorMessage } from "../../../lib/api-error";

const API_URL = serverApiUrl();

export type ActionResult = { success: true } | { success: false; error: string };

export async function createService(formData: FormData): Promise<ActionResult> {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;

  if (!token) return { success: false, error: "Sessão expirada. Entre novamente." };

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

  // Ex.: limite de serviços do plano (402) ou campo inválido (400).
  if (!res.ok) {
    return { success: false, error: await apiErrorMessage(res, "Não foi possível registrar o serviço.") };
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
  if (!res.ok) {
    // Ex.: cota de deploys do plano esgotada (402) ou serviço inexistente (404).
    return { success: false, error: await apiErrorMessage(res, "Não foi possível iniciar o deploy.") };
  }

  revalidatePath(`/services/${serviceId}`);
  return { success: true, deployment: await res.json() };
}
