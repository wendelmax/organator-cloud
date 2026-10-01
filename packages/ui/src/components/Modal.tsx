"use client";

import * as React from "react";
import { cn } from "../utils";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function Modal({ isOpen, onClose, title, description, children, className }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity" 
        onClick={onClose} 
      />
      <div className={cn("relative z-50 grid w-full max-w-lg gap-4 rounded-xl border border-neutral-800 bg-neutral-950 p-6 shadow-lg sm:rounded-2xl", className)}>
        <div className="flex flex-col space-y-1.5 text-center sm:text-left">
          <h2 className="text-lg font-semibold leading-none tracking-tight text-neutral-50">{title}</h2>
          {description && <p className="text-sm text-neutral-400">{description}</p>}
        </div>
        <div className="py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
