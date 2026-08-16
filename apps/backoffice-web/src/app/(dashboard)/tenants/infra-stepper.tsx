"use client";

import { Button } from "@organator/ui";

const INFRA_PHASES = ['DB', 'NETWORK', 'DNS', 'DONE'];

export function TenantInfraStepper({
  currentPhase = 'DB',
  status = 'PENDING',
  onRetry,
}: {
  currentPhase?: string;
  status?: string;
  onRetry?: () => void;
}) {
  const currentIdx = INFRA_PHASES.indexOf(currentPhase);

  return (
    <div className="space-y-3 rounded-lg bg-neutral-900 border border-neutral-800 p-4">
      <div className="flex items-center justify-between text-xs font-semibold text-neutral-300">
        <span>Fases do Provisionamento de Infraestrutura</span>
        <span className={status === 'READY' ? 'text-green-400 font-mono' : 'text-amber-400 font-mono'}>{status}</span>
      </div>

      <div className="flex gap-2">
        {INFRA_PHASES.map((phase, idx) => {
          const isDone = currentIdx > idx || status === 'READY';
          const isCurrent = currentIdx === idx && status !== 'READY';

          return (
            <div key={phase} className="flex-1 space-y-1 text-center">
              <div
                className={`h-2 rounded-full transition-all duration-300 ${
                  isDone ? 'bg-green-500' : isCurrent ? 'bg-amber-400 animate-pulse' : 'bg-neutral-800'
                }`}
              />
              <div className="text-[10px] font-mono text-neutral-400">{phase}</div>
            </div>
          );
        })}
      </div>

      {onRetry && (
        <div className="pt-2 flex justify-end">
          <Button variant="outline" size="sm" onClick={onRetry}>
            Re-tentar Infraestrutura
          </Button>
        </div>
      )}
    </div>
  );
}
