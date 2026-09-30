"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  User,
  AlertTriangle,
  Clock,
  Play,
  Loader2,
  Eye,
  Stethoscope,
} from "lucide-react"
import { formatCPF, formatPhone } from "@/lib/schemas"
import { getAttendanceStatusMeta } from "@/lib/attendance-status"
import { cn } from "@/lib/utils"
import {
  type AttendanceQueueItem,
  formatAge,
} from "./attendance-utils"
import { PatientAlertModal } from "./patient-alert-modal"

interface AttendanceQueueRowProps {
  item: AttendanceQueueItem
  onViewPatient: (patientId: string) => void
  // Abre o cabeçalho do paciente (Parte 2) para atendimentos já iniciados.
  onContinue: () => void
  onStart: (item: AttendanceQueueItem) => Promise<void>
}

// Os rótulos/cores de status da fila vêm do domínio compartilhado do módulo
// de Atendimento (ver @/lib/attendance-status), garantindo identidade visual
// única entre a fila e o cabeçalho do paciente.

export function AttendanceQueueRow({
  item,
  onViewPatient,
  onContinue,
  onStart,
}: AttendanceQueueRowProps) {
  const [isStarting, setIsStarting] = useState(false)
  const [showAlert, setShowAlert] = useState(false)
  const [showProcedures, setShowProcedures] = useState(false)

  const meta = getAttendanceStatusMeta(item.status)
  const canStart = ["paid", "awaiting_attendance"].includes(item.status)
  const isInProgress = item.status === "in_progress"
  const isCompleted = item.status === "completed"

  const hiddenProcedures = item.procedures.length - 2

  async function handleStart() {
    setIsStarting(true)
    try {
      await onStart(item)
    } finally {
      setIsStarting(false)
    }
  }

  return (
    <>
      <div
        className={cn(
          "rounded-lg border border-gray-200 border-l-4 bg-white p-4 transition-shadow hover:shadow-sm",
          meta.accent,
          isCompleted && "opacity-80"
        )}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          {/* Horário */}
          <div className="flex shrink-0 items-center gap-2 lg:w-24 lg:flex-col lg:items-start lg:gap-0">
            <Clock className="h-4 w-4 text-gray-400 lg:hidden" />
            <span className="text-lg font-bold tabular-nums text-gray-900">
              {item.appointmentTime || "--:--"}
            </span>
            {!item.appointmentTime && (
              <span className="text-[11px] text-gray-400">Sem horário</span>
            )}
          </div>

          {/* Dados do paciente */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <User className="h-4 w-4 shrink-0 text-gray-400" />
              <span className="font-medium text-gray-900">
                {item.patient.fullName}
              </span>
              {item.patient.hasHealthAlert && (
                <button
                  type="button"
                  onClick={() => setShowAlert(true)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 transition-colors hover:bg-amber-200"
                  title="Ver observações importantes do paciente"
                >
                  <AlertTriangle className="h-3 w-3" />
                  Atenção
                </button>
              )}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
              <span>{formatAge(item.patient.age)}</span>
              <span className="text-gray-300">•</span>
              <span>CPF: {formatCPF(item.patient.cpf)}</span>
              {item.patient.phone && (
                <>
                  <span className="text-gray-300">•</span>
                  <span>{formatPhone(item.patient.phone)}</span>
                </>
              )}
            </div>

            {/* Procedimentos */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {item.procedures.length === 0 ? (
                <span className="text-xs text-gray-400">
                  Sem procedimentos registrados
                </span>
              ) : (
                <>
                  {item.procedures.slice(0, 2).map((p) => (
                    <Badge key={p.id} variant="default" className="text-[11px]">
                      {p.name}
                      {p.quantity > 1 ? ` ×${p.quantity}` : ""}
                    </Badge>
                  ))}
                  {hiddenProcedures > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowProcedures((v) => !v)}
                      className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
                    >
                      {showProcedures
                        ? `Ocultar ${hiddenProcedures}`
                        : `+ ${hiddenProcedures} outro${hiddenProcedures > 1 ? "s" : ""}`}
                    </button>
                  )}
                </>
              )}
            </div>

            {showProcedures && hiddenProcedures > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {item.procedures.slice(2).map((p) => (
                  <Badge key={p.id} variant="default" className="text-[11px]">
                    {p.name}
                    {p.quantity > 1 ? ` ×${p.quantity}` : ""}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Status + ação */}
          <div className="flex shrink-0 items-center justify-between gap-3 lg:flex-col lg:items-end lg:justify-center">
            <Badge className={cn("gap-1.5", meta.badge)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
              {meta.label}
            </Badge>

            {canStart && (
              <Button
                size="sm"
                onClick={handleStart}
                disabled={isStarting}
                className="whitespace-nowrap"
              >
                {isStarting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Iniciando...
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" />
                    Iniciar atendimento
                  </>
                )}
              </Button>
            )}

            {isInProgress && (
              <Button
                size="sm"
                variant="outline"
                onClick={onContinue}
                className="whitespace-nowrap"
              >
                <Stethoscope className="h-3.5 w-3.5" />
                Continuar atendimento
              </Button>
            )}

            {isCompleted && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onViewPatient(item.patient.id)}
                className="whitespace-nowrap"
              >
                <Eye className="h-3.5 w-3.5" />
                Visualizar
              </Button>
            )}
          </div>
        </div>
      </div>

      {showAlert && (
        <PatientAlertModal
          patientId={item.patient.id}
          patientName={item.patient.fullName}
          cpf={item.patient.cpf}
          onClose={() => setShowAlert(false)}
        />
      )}
    </>
  )
}
