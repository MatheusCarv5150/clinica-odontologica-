"use client"

// ===========================================================================
// SWITCH — Componente de alternância (on/off)
// ===========================================================================
// Implementação minimalista seguindo o padrão shadcn/ui, sem dependência
// extra. Suporta aria-label e desabilitado.
// ===========================================================================

import { useId } from "react"
import { cn } from "@/lib/utils"

interface SwitchProps {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  id?: string
  "aria-label"?: string
}

export function Switch({
  checked = false,
  onCheckedChange,
  disabled = false,
  id: externalId,
  "aria-label": ariaLabel,
}: SwitchProps) {
  const generatedId = useId()
  const id = externalId || generatedId

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
        checked ? "bg-blue-600" : "bg-gray-200",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out",
          checked ? "translate-x-5" : "translate-x-0"
        )}
      />
    </button>
  )
}