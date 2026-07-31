"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { revalidatePath } from "next/cache";

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export async function createService(formData: FormData) {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  const tenantId = (session as any)?.user?.tenantId || (session as any)?.tenantId;

  if (!token) throw new Error("Unauthorized");

  const payload = {
    tenantId: tenantId || "default-tenant",
    name: formData.get("name"),
    cloudProvider: formData.get("cloudProvider"),
    repositoryUrl: formData.get("repository") || formData.get("repositoryUrl"),
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
