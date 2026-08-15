"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

const API_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
).replace(/\/v1$/, "");

export default function OrganizationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const { data: session, update } = useSession();
  const token = (session as any)?.accessToken;
  const tenantId = (session?.user as any)?.tenantId;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!token || !slug) return;
    (async () => {
      const contextResponse = await fetch(
        `${API_URL}/v1/tenants/context/${encodeURIComponent(slug)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!contextResponse.ok) return router.replace("/settings");
      const context = await contextResponse.json();
      if (tenantId !== context.tenant.id) {
        const switchResponse = await fetch(`${API_URL}/v1/auth/switch-tenant`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ tenantId: context.tenant.id }),
        });
        if (!switchResponse.ok) return router.replace("/settings");
        const switched = await switchResponse.json();
        await update({
          accessToken: switched.access_token,
          tenantId: context.tenant.id,
          role: context.role,
        });
      }
      setReady(true);
    })();
  }, [token, slug, router, tenantId, update]);
  if (!ready)
    return (
      <div className="p-8 text-neutral-400">
        Validando contexto da organização...
      </div>
    );
  return children;
}
