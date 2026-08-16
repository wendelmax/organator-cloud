"use client";

import { useState, useEffect } from "react";

export function GracePeriodBanner({ graceEndsAt }: { graceEndsAt?: string | null }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
  }, []);

  if (!graceEndsAt || now === null) return null;

  const daysLeft = Math.max(
    0,
    Math.ceil((new Date(graceEndsAt).getTime() - now) / (1000 * 60 * 60 * 24))
  );

  return (
    <div className="rounded-lg bg-amber-950/40 border border-amber-800/60 p-4 mb-4 text-amber-200 text-xs">
      <div className="font-semibold flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span>⚠️</span>
          <span>Período de Graça de Downgrade Ativo</span>
        </span>
        <span className="font-mono text-amber-300 bg-amber-900/60 px-2 py-0.5 rounded">{daysLeft} dias restantes</span>
      </div>
      <p className="mt-1 text-amber-300/80">
        A redução de infraestrutura dedicada para este tenant será executada em {new Date(graceEndsAt).toLocaleDateString()}.
      </p>
    </div>
  );
}
