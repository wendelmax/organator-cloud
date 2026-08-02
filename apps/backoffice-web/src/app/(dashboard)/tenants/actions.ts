"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { revalidatePath } from "next/cache";

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export async function createTenant(formData: FormData) {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) throw new Error("Unauthorized");

  const payload = {
    name: formData.get("name"),
    plan: (formData.get("plan") as string) || "free",
    adminEmail: (session as any)?.user?.email,
  };

  const res = await fetch(`${API_URL}/v1/tenants`, {
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

export async function getMembers() {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) throw new Error("Unauthorized");

  const res = await fetch(`${API_URL}/v1/tenants/members`, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error("Failed to fetch members");
  }

  return res.json();
}

export async function addMember(formData: FormData) {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) throw new Error("Unauthorized");

  const payload = {
    name: (formData.get("name") as string) || undefined,
    email: formData.get("email") as string,
    role: (formData.get("role") as string) || "VIEWER",
    password: (formData.get("password") as string) || undefined,
  };

  const res = await fetch(`${API_URL}/v1/tenants/members`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || "Failed to add member");
  }

  revalidatePath("/tenants");
  return { success: true };
}

export async function updateMemberRole(userId: string, role: string) {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) throw new Error("Unauthorized");

  const res = await fetch(`${API_URL}/v1/tenants/members/${userId}/role`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ role })
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || "Failed to update member role");
  }

  revalidatePath("/tenants");
  return { success: true };
}

export async function removeMember(userId: string) {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) throw new Error("Unauthorized");

  const res = await fetch(`${API_URL}/v1/tenants/members/${userId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || "Failed to remove member");
  }

  revalidatePath("/tenants");
  return { success: true };
}

export async function updateTenant(tenantId: string, formData: FormData) {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) throw new Error("Unauthorized");

  const payload: Record<string, string> = {};
  const name = formData.get("name") as string;
  const slug = formData.get("slug") as string;
  if (name) payload.name = name;
  if (slug) payload.slug = slug;

  const res = await fetch(`${API_URL}/v1/tenants/${tenantId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || "Failed to update tenant");
  }

  revalidatePath("/tenants");
  return { success: true };
}

export async function changePlan(tenantId: string, plan: string) {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) throw new Error("Unauthorized");

  const res = await fetch(`${API_URL}/v1/tenants/${tenantId}/plan`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ plan })
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || "Failed to change plan");
  }

  revalidatePath("/tenants");
  return { success: true };
}

export async function suspendTenant(tenantId: string) {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) throw new Error("Unauthorized");

  const res = await fetch(`${API_URL}/v1/tenants/${tenantId}/suspend`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || "Failed to suspend tenant");
  }

  revalidatePath("/tenants");
  return { success: true };
}

export async function reactivateTenant(tenantId: string) {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) throw new Error("Unauthorized");

  const res = await fetch(`${API_URL}/v1/tenants/${tenantId}/reactivate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || "Failed to reactivate tenant");
  }

  revalidatePath("/tenants");
  return { success: true };
}

export async function archiveTenant(tenantId: string) {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) throw new Error("Unauthorized");

  const res = await fetch(`${API_URL}/v1/tenants/${tenantId}/archive`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || "Failed to archive tenant");
  }

  revalidatePath("/tenants");
  return { success: true };
}

export async function transferOwnership(tenantId: string, newOwnerId: string) {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  if (!token) throw new Error("Unauthorized");

  const res = await fetch(`${API_URL}/v1/tenants/${tenantId}/transfer-ownership`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ newOwnerId })
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || "Failed to transfer ownership");
  }

  revalidatePath("/tenants");
  return { success: true };
}
