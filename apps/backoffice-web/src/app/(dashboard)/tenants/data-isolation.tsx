"use client";

import { useState, useTransition } from "react";
import { Button, Modal } from "@organator/ui";
import { updateDataIsolation, reconcileDataIsolation } from "./actions";

export interface DataIsolationProps {
  tenantId: string;
  tenantName: string;
  currentMode?: 'SHARED' | 'SCHEMA' | 'DATABASE';
  overridden?: boolean;
  status?: string;
  phase?: string;
  onClose: () => void;
}

export function DataIsolationModal({
  tenantId,
  tenantName,
  currentMode = 'SHARED',
  overridden = false,
  status = 'PENDING',
  phase = 'PREPARE',
  onClose,
}: DataIsolationProps) {
  const [selectedMode, setSelectedMode] = useState<string>(overridden ? currentMode : 'default');
  const [confirmDestructiveOpen, setConfirmDestructiveOpen] = useState(false);
  const [pendingMode, setPendingMode] = useState<'SHARED' | 'SCHEMA' | 'DATABASE' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isReconciling = status === 'RECONCILING';

  const modeRanks = { SHARED: 0, SCHEMA: 1, DATABASE: 2 };

  function handleSave() {
    setError(null);
    const targetMode = selectedMode === 'default' ? null : (selectedMode as 'SHARED' | 'SCHEMA' | 'DATABASE');

    // Check if downgrade
    if (targetMode && modeRanks[targetMode] < modeRanks[currentMode]) {
      setPendingMode(targetMode);
      setConfirmDestructiveOpen(true);
      return;
    }

    executeChange(targetMode, false);
  }

  function executeChange(mode: 'SHARED' | 'SCHEMA' | 'DATABASE' | null, confirmDestructive: boolean) {
    startTransition(async () => {
      try {
        await updateDataIsolation(tenantId, mode, confirmDestructive);
        setConfirmDestructiveOpen(false);
        onClose();
      } catch (err: any) {
        setError(err.message || 'Falha ao atualizar isolamento de dados');
      }
    });
  }

  function handleReconcile() {
    setError(null);
    startTransition(async () => {
      try {
        await reconcileDataIsolation(tenantId);
        onClose();
      } catch (err: any) {
        setError(err.message || 'Falha ao iniciar reconciliação');
      }
    });
  }

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`Isolamento de Dados — ${tenantName}`}
      description="Configure o nível de isolamento de banco de dados do tenant no Data Plane."
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium text-neutral-200" htmlFor="data-isolation-select">
            Modo de Isolamento
          </label>
          <select
            id="data-isolation-select"
            aria-label="Isolamento de dados"
            value={selectedMode}
            disabled={isPending || isReconciling}
            onChange={(e) => setSelectedMode(e.target.value)}
            className="flex h-10 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
          >
            <option value="default">Usar padrão do plano</option>
            <option value="SHARED">SHARED — menor custo, RLS por tenant</option>
            <option value="SCHEMA">SCHEMA — schema e role exclusivos</option>
            <option value="DATABASE">DATABASE — database e credencial exclusivos</option>
          </select>
        </div>

        <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-3 text-xs space-y-1.5 text-neutral-300">
          <div className="flex justify-between">
            <span>Status Atual:</span>
            <span className="font-semibold text-neutral-100">{status} ({phase})</span>
          </div>
          <div className="flex justify-between">
            <span>Modo Ativo:</span>
            <span className="font-semibold text-neutral-100">{currentMode}</span>
          </div>
          <div className="flex justify-between">
            <span>Override Ativo:</span>
            <span className="font-semibold text-neutral-100">{overridden ? 'Sim' : 'Não (Padrão)'}</span>
          </div>
        </div>

        <div className="pt-4 flex justify-between gap-2">
          <Button
            variant="outline"
            type="button"
            disabled={isPending || isReconciling}
            onClick={handleReconcile}
          >
            Reconciliar Infraestrutura
          </Button>

          <div className="flex gap-2">
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={isPending || isReconciling}
              onClick={handleSave}
            >
              {isPending ? "Salvando..." : "Salvar Alterações"}
            </Button>
          </div>
        </div>

        {confirmDestructiveOpen && (
          <Modal
            isOpen={true}
            onClose={() => setConfirmDestructiveOpen(false)}
            title="Confirmar Redução de Isolamento"
            description="Atenção: A migração para um modo de menor isolamento moverá os dados e manterá uma janela de rollback por 24 horas."
          >
            <div className="space-y-4">
              <p className="text-sm text-neutral-300">
                Esta ação requer confirmação pois os dados do tenant serão migrados para um ambiente compartilhado/schema com Row-Level Security.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setConfirmDestructiveOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  className="bg-amber-600 hover:bg-amber-500 text-white"
                  onClick={() => executeChange(pendingMode, true)}
                >
                  Confirmar Migração
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </Modal>
  );
}
