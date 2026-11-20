"use client";

import { Printer } from "lucide-react";

export function PrintButton({ disabled }: { disabled?: boolean }) {
  return (
    <button type="button" className="btn-primary" disabled={disabled} onClick={() => window.print()}>
      <Printer className="size-4" /> In
    </button>
  );
}
