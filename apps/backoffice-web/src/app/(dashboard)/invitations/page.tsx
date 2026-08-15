"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
} from "@organator/ui";

const API_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
).replace(/\/v1$/, "");

export default function InvitationsPage() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken;
  const [items, setItems] = useState<any[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [deliveryToken, setDeliveryToken] = useState<string | null>(null);
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const load = useCallback(async () => {
    const response = await fetch(`${API_URL}/v1/tenant-invitations`, {
      headers,
    });
    if (response.ok) setItems(await response.json());
  }, [token]);
  useEffect(() => {
    if (token) load();
  }, [token, load]);
  async function create() {
    const response = await fetch(`${API_URL}/v1/tenant-invitations`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, role }),
    });
    if (!response.ok) return alert("Não foi possível criar o convite");
    const result = await response.json();
    setDeliveryToken(result.token);
    setEmail("");
    await load();
  }
  async function revoke(id: string) {
    if (!confirm("Revogar este convite?")) return;
    await fetch(`${API_URL}/v1/tenant-invitations/${id}`, {
      method: "DELETE",
      headers,
    });
    await load();
  }
  async function resend(id: string) {
    const response = await fetch(
      `${API_URL}/v1/tenant-invitations/${id}/resend`,
      { method: "POST", headers },
    );
    if (!response.ok) return alert("Não foi possível reenviar o convite");
    const result = await response.json();
    setDeliveryToken(result.token);
    await load();
  }
  const statusOf = (item: any) =>
    item.acceptedAt
      ? "Aceito"
      : item.revokedAt
        ? "Revogado"
        : new Date(item.expiresAt) < new Date()
          ? "Expirado"
          : "Pendente";
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Convites</h1>
        <p className="text-neutral-400 mt-1">
          Gerencie o acesso de novos membros da organização.
        </p>
      </div>
      {deliveryToken && (
        <Card className="border-amber-700 bg-amber-950/30">
          <CardContent className="p-5">
            <p className="text-amber-300">
              Link/token de aceite exibido uma única vez para entrega segura:
            </p>
            <code className="mt-2 block break-all rounded bg-neutral-950 p-3 text-emerald-300">
              {deliveryToken}
            </code>
          </CardContent>
        </Card>
      )}
      <Card className="bg-neutral-900 border-neutral-800">
        <CardHeader>
          <CardTitle>Novo convite</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col md:flex-row gap-3">
          <Input
            value={email}
            onChange={(event: any) => setEmail(event.target.value)}
            placeholder="email@empresa.com"
          />
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="rounded border border-neutral-700 bg-neutral-950 px-3 text-white"
          >
            <option>MEMBER</option>
            <option>ADMIN</option>
            <option>BILLING</option>
            <option>DEVELOPER</option>
          </select>
          <Button onClick={create}>Convidar</Button>
        </CardContent>
      </Card>
      <Card className="bg-neutral-900 border-neutral-800">
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded border border-neutral-800 p-3"
            >
              <div>
                <p className="text-white">
                  {item.email} · {item.role}
                </p>
                <p className="text-xs text-neutral-500">
                  {statusOf(item)} · expira{" "}
                  {new Date(item.expiresAt).toLocaleString()}
                </p>
              </div>
              {statusOf(item) === "Pendente" && (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => resend(item.id)}>
                    Reenviar
                  </Button>
                  <Button variant="outline" onClick={() => revoke(item.id)}>
                    Revogar
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
