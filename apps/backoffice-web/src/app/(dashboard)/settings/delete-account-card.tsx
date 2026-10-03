"use client";

import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@organator/ui";
import { publicApiUrl } from "../../../lib/public-env";
import { apiErrorMessage } from "../../../lib/api-error";

const API_URL = publicApiUrl();

/** Direito ao esquecimento (LGPD): apaga a própria conta, sem volta. */
export function DeleteAccountCard() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;
  const isPlatformAdmin = (session?.user as any)?.role === "PLATFORM_ADMIN";
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!token || isPlatformAdmin) return null;

  async function erase() {
    setBusy(true);
    setError(null);
    const res = await fetch(`${API_URL}/v1/compliance/erasure`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      // Contas SSO confirmam com o e-mail; as demais, com a senha.
      body: JSON.stringify({ password, email: password }),
    });
    if (!res.ok) {
      setError(await apiErrorMessage(res, "Não foi possível excluir a conta."));
      setBusy(false);
      return;
    }
    await signOut({ callbackUrl: "/login?erased=true" });
  }

  return (
    <Card className="bg-neutral-900 border-red-900/60">
      <CardHeader>
        <CardTitle className="text-red-300">Excluir minha conta</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-neutral-400">
          Apaga sua conta, sessões e acessos e anonimiza seu nome nos registros de auditoria. Cobranças
          já emitidas continuam no Stripe por obrigação contábil. Esta ação não pode ser desfeita.
        </p>
        {!open ? (
          <Button variant="outline" className="text-red-300" onClick={() => setOpen(true)}>
            Excluir minha conta
          </Button>
        ) : (
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-neutral-200">Confirme com sua senha (ou seu e-mail, se entra por SSO)</span>
              <Input
                type="password"
                aria-label="Confirmação para excluir a conta"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <p role="status" className="text-red-300">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button onClick={() => void erase()} disabled={busy || !password}>
                {busy ? "Excluindo..." : "Excluir definitivamente"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
