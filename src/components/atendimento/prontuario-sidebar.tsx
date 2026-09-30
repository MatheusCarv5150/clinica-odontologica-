"use client"

import { cn } from "@/lib/utils"

// ===========================================================================
// Sidebar de navegação do PRONTUÁRIO ÚNICO (módulo Atendimento — Parte 4).
//
// O Atendimento não é um conjunto de telas independentes: é um único
// prontuário clínico com áreas de navegação. A sidebar apenas troca a área
// exibida; o cabeçalho do paciente permanece acima.
//
// Todas as áreas do prontuário estão implementadas (Partes 3 a 10). A flag
// `enabled` continua existindo para futuras áreas em roadmap.
// ===========================================================================

export type ProntuarioSection =
  | "historico"
  | "anamnese"
  | "odontograma"
  | "registro"
  | "evolucao"
  | "procedimentos"
  | "plano"
  | "prescricao"
  | "documentos"

export interface ProntuarioSectionMeta {
  key: ProntuarioSection
  label: string
  description: string
  enabled: boolean
}

export const PRONTUARIO_SECTIONS: ProntuarioSectionMeta[] = [
  {
    key: "historico",
    label: "Histórico",
    description: "Atendimentos anteriores",
    enabled: true,
  },
  {
    key: "anamnese",
    label: "Anamnese",
    description: "Avaliação clínica e informações do paciente",
    enabled: true,
  },
  {
    key: "odontograma",
    label: "Odontograma",
    description: "Situação odontológica atual",
    enabled: true,
  },
  {
    // Parte 6 — REGISTRO DO ATENDIMENTO: o que aconteceu NAQUELA consulta.
    key: "registro",
    label: "Registro do atendimento",
    description: "Documentar o atendimento atual",
    enabled: true,
  },
  {
    // Parte 8 — EVOLUÇÃO: a linha do tempo clínica longitudinal do paciente.
    // Diferente do Registro: aqui NÃO se digita nada, apenas se lê a
    // trajetória clínica construída pelos atendimentos registrados.
    key: "evolucao",
    label: "Evolução",
    description: "Linha do tempo clínica do paciente",
    enabled: true,
  },
  {
    key: "procedimentos",
    label: "Procedimentos",
    description: "Previstos e realizados no atendimento",
    enabled: true,
  },
  {
    key: "plano",
    label: "Plano de tratamento",
    description: "Planejamento e etapas do tratamento",
    enabled: true,
  },
  {
    key: "prescricao",
    label: "Prescrição",
    description: "Receitas e orientações",
    enabled: true,
  },
  {
    key: "documentos",
    label: "Documentos / Imagens",
    description: "Exames, radiografias e anexos",
    enabled: true,
  },
]

interface ProntuarioSidebarProps {
  active: ProntuarioSection
  onChange: (section: ProntuarioSection) => void
  // Contadores opcionais por seção (ex.: nº de alertas clínicos na anamnese).
  badges?: Partial<Record<ProntuarioSection, number>>
}

export function ProntuarioSidebar({
  active,
  onChange,
  badges,
}: ProntuarioSidebarProps) {
  return (
    <nav
      aria-label="Navegação do prontuário"
      className="w-full shrink-0 lg:w-56"
    >
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <p className="border-b border-gray-100 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Prontuário
        </p>

        <ul className="p-2">
          {PRONTUARIO_SECTIONS.map((section) => {
            const isActive = section.key === active
            const badge = badges?.[section.key]

            if (!section.enabled) {
              return (
                <li key={section.key}>
                  <div
                    className="flex cursor-not-allowed items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-gray-300"
                    title="Em breve"
                    aria-disabled="true"
                  >
                    <span className="truncate">{section.label}</span>
                    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-400">
                      Breve
                    </span>
                  </div>
                </li>
              )
            }

            return (
              <li key={section.key}>
                <button
                  type="button"
                  onClick={() => onChange(section.key)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                    isActive
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  )}
                >
                  <span className="truncate">{section.label}</span>
                  {typeof badge === "number" && badge > 0 && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                      {badge}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
