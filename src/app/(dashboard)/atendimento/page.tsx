"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { AttendanceBoard } from "@/components/atendimento/attendance-board"

function AtendimentoContent() {
  const searchParams = useSearchParams()
  // Parâmetros mantidos pela navegação iniciada na própria tela de Atendimento
  // (Parte 1): "appointment" abre o cabeçalho do atendimento (Parte 2) e
  // "patient" abre o painel de cadastro do paciente.
  const appointmentId = searchParams.get("appointment")
  const patientId = searchParams.get("patient")

  return (
    <AttendanceBoard
      appointmentIdToOpen={appointmentId}
      patientIdToOpen={patientId}
      onPatientPanelClosed={() => {
        if (patientId) {
          window.history.replaceState(null, "", "/atendimento")
        }
      }}
    />
  )
}

export default function AtendimentoPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20 text-sm text-gray-400">
          Carregando...
        </div>
      }
    >
      <AtendimentoContent />
    </Suspense>
  )
}
