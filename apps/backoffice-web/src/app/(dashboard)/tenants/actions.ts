"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { revalidatePath } from "next/cache";

export async function createTenant(formData: FormData) {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) throw new Error("Unauthorized");

  const payload = {
    name: formData.get("name"),
    slug: formData.get("slug"),
    planId: "free"
  };

  const res = await fetch("http://localhost:3001/v1/tenants", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error("Failed to create tenant");
  }

  revalidatePath("/tenants");
  return { success: true };
}
