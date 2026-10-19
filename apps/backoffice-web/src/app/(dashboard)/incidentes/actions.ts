"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { revalidatePath } from "next/cache";
import { serverApiUrl } from "../../../lib/public-env";
import { apiErrorMessage } from "../../../lib/api-error";

const API_URL = serverApiUrl();

export type ActionResult = { success: true } | { success: false; error: string };

/** Abre um incidente (POST /v1/incidents); dedup de alertKey devolve o já existente. */
export async function createIncident(formData: FormData): Promise<ActionResult> {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) return { success: false, error: "Sessão expirada. Entre novamente." };

  const payload = {
    title: formData.get("title"),
    severity: formData.get("severity") || undefined,
    status: formData.get("status") || undefined,
    component: formData.get("component") || undefined,
    // Checkbox do HTML chega como "on" quando marcado e ausente quando não.
    public: formData.get("public") === "on",
    assigneeEmail: formData.get("assigneeEmail") || undefined,
    source: formData.get("source") || undefined,
    alertKey: formData.get("alertKey") || undefined,
    postmortemUrl: formData.get("postmortemUrl") || undefined,
  };

  const res = await fetch(`${API_URL}/v1/incidents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  // Ex.: título vazio ou enum inválido (400). Dedup de alertKey vem como 200/201.
  if (!res.ok) {
    return { success: false, error: await apiErrorMessage(res, "Não foi possível abrir o incidente.") };
  }

  revalidatePath("/incidentes");
  return { success: true };
}

/** Atualiza campos do incidente (PATCH /v1/incidents/:id). */
export async function updateIncident(
  id: string,
  patch: Record<string, unknown>,
): Promise<ActionResult> {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) return { success: false, error: "Sessão expirada. Entre novamente." };

  const res = await fetch(`${API_URL}/v1/incidents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(patch)
  });

  if (!res.ok) {
    return { success: false, error: await apiErrorMessage(res, "Não foi possível atualizar o incidente.") };
  }

  revalidatePath(`/incidentes/${id}`);
  return { success: true };
}

/** Resolve o incidente (PATCH com status=resolved) e invalida lista + detalhe. */
export async function resolveIncident(id: string): Promise<ActionResult> {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) return { success: false, error: "Sessão expirada. Entre novamente." };

  const res = await fetch(`${API_URL}/v1/incidents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ status: "resolved" })
  });

  if (!res.ok) {
    return { success: false, error: await apiErrorMessage(res, "Não foi possível resolver o incidente.") };
  }

  revalidatePath("/incidentes");
  revalidatePath(`/incidentes/${id}`);
  return { success: true };
}

/** Nova entrada na linha do tempo (POST /v1/incidents/:id/updates); autor vem do JWT. */
export async function addIncidentUpdate(id: string, formData: FormData): Promise<ActionResult> {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) return { success: false, error: "Sessão expirada. Entre novamente." };

  // Checkbox do HTML chega como "on" quando marcado e ausente quando não.
  const payload = {
    status: formData.get("status"),
    message: formData.get("message"),
    internal: formData.get("internal") === "on",
  };

  const res = await fetch(`${API_URL}/v1/incidents/${encodeURIComponent(id)}/updates`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  // Ex.: status fora do enum (400) ou mensagem acima de 2000 caracteres (400).
  if (!res.ok) {
    return { success: false, error: await apiErrorMessage(res, "Não foi possível registrar a atualização.") };
  }

  revalidatePath(`/incidentes/${id}`);
  return { success: true };
}

/** Vincula um tenant ao blast radius do incidente (POST /v1/incidents/:id/affected). */
export async function addAffectedTenant(id: string, tenantId: string): Promise<ActionResult> {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) return { success: false, error: "Sessão expirada. Entre novamente." };

  const res = await fetch(`${API_URL}/v1/incidents/${encodeURIComponent(id)}/affected`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ tenantId })
  });

  // Ex.: tenant inexistente (404).
  if (!res.ok) {
    return { success: false, error: await apiErrorMessage(res, "Não foi possível vincular o tenant.") };
  }

  revalidatePath(`/incidentes/${id}`);
  return { success: true };
}

/** Desvincula um tenant do blast radius (DELETE /v1/incidents/:id/affected/:tenantId). */
export async function removeAffectedTenant(id: string, tenantId: string): Promise<ActionResult> {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) return { success: false, error: "Sessão expirada. Entre novamente." };

  const res = await fetch(
    `${API_URL}/v1/incidents/${encodeURIComponent(id)}/affected/${encodeURIComponent(tenantId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!res.ok) {
    return { success: false, error: await apiErrorMessage(res, "Não foi possível desvincular o tenant.") };
  }

  revalidatePath(`/incidentes/${id}`);
  return { success: true };
}
