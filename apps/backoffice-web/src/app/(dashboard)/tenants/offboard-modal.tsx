"use client";

import { Modal, Button } from "@organator/ui";

interface OffboardModalProps {
  isOpen: boolean;
  tenantName: string;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}

export function OffboardModal({ isOpen, tenantName, onClose, onConfirm, isPending }: OffboardModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Offboarding Definitivo: ${tenantName}`}
      description="Esta ação executará um snapshot final dos dados e provisionará o encerramento completo (LGPD) dos recursos associados a este tenant. Esta ação é irreversível."
    >
      <div className="pt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="outline" className="text-red-400 hover:text-red-300" disabled={isPending} onClick={onConfirm}>
          {isPending ? "Processando..." : "Confirmar Exclusão Definitiva"}
        </Button>
      </div>
    </Modal>
  );
}
