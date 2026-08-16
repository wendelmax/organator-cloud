"use client";

import { Modal, Button, Input } from "@organator/ui";

interface CloneModalProps {
  isOpen: boolean;
  tenantName: string;
  onClose: () => void;
  onConfirm: (targetName: string, targetSlug: string) => void;
  isPending: boolean;
}

export function CloneModal({ isOpen, tenantName, onClose, onConfirm, isPending }: CloneModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Clonar Ambiente: ${tenantName}`}
      description="Crie uma cópia idêntica deste tenant (incluindo schema e infraestrutura básica)."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          onConfirm(fd.get("name") as string, fd.get("slug") as string);
        }}
        className="space-y-4"
      >
        <div className="space-y-2">
          <label className="text-sm font-medium text-neutral-200">Nome do Novo Tenant</label>
          <Input name="name" required placeholder="Ex: Tenant Clonado" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-neutral-200">Slug</label>
          <Input name="slug" required placeholder="Ex: tenant-clonado" />
        </div>
        <div className="pt-4 flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Clonando..." : "Confirmar Clone"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
