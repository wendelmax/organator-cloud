"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button, Modal } from "@organator/ui";
import { publicApiUrl } from "../../../lib/public-env";
import { apiErrorMessage } from "../../../lib/api-error";

interface Member {
  id: string;
  name?: string | null;
  email: string;
  role: string;
}

/**
 * Suporte (#103): o admin da plataforma assume a sessão de um membro por até
 * 30 minutos, com motivo obrigatório. Tudo fica na auditoria.
 */
export function ImpersonateModal({
  tenantName,
  members,
  onClose,
}: {
  tenantName: string;
  members: Member[];
  onClose: () => void;
}) {
  const { data: session, update } = useSession();
  const router = useRouter();
  const candidates = members.filter((member) => member.role !== "PLATFORM_ADMIN");
  const [userId, setUserId] = useState(candidates[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    const res = await fetch(`${publicApiUrl()}/v1/auth/impersonate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${(session as any)?.accessToken}`,
      },
      body: JSON.stringify({ userId, reason }),
    });
    if (!res.ok) {
      setError(await apiErrorMessage(res, "Não foi possível iniciar a sessão de suporte."));
      setBusy(false);
      return;
    }
    const data = await res.json();
    // A sessão do painel passa a ser a do usuário (role/tenant validados na API).
    await update({ accessToken: data.access_token });
    router.push("/services");
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Acessar como — ${tenantName}`}
      description="Sessão de suporte de até 30 minutos. O motivo e cada ação ficam registrados na auditoria."
    >
      <div className="space-y-4">
        {candidates.length === 0 ? (
          <p className="text-sm text-neutral-400">Nenhum membro disponível para acesso de suporte.</p>
        ) : (
          <>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-neutral-200">Usuário</span>
              <select
                aria-label="Usuário"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200"
              >
                {candidates.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name || member.email} ({member.role})
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-neutral-200">Motivo</span>
              <textarea
                aria-label="Motivo"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: Ticket #123 — cliente não consegue fazer deploy"
                className="w-full rounded-md border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-200"
              />
            </label>
          </>
        )}
        {error && (
          <p role="status" className="text-sm text-red-300">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void start()}
            disabled={busy || !userId || reason.trim().length < 5}
          >
            {busy ? "Iniciando..." : "Iniciar sessão de suporte"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
