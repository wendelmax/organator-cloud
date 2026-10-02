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
