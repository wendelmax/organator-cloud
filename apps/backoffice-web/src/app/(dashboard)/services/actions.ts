"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { revalidatePath } from "next/cache";

export async function createService(formData: FormData) {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) throw new Error("Unauthorized");

  const payload = {
    name: formData.get("name"),
    repository: formData.get("repository"),
    cloudProvider: formData.get("cloudProvider"),
    // A configuração VPS mockada
    vpsHost: formData.get("vpsHost") || undefined,
  };

  const res = await fetch("http://localhost:3001/v1/services", {
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
