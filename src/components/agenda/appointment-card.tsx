"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  User,
  DollarSign,
  AlertTriangle,
  MessageCircle,
  Ban,
  CreditCard,
  HeartPulse,
} from "lucide-react"
import {
  STATUS_LABELS,
  STATUS_COLORS,
  formatCurrency,
  getWhatsAppLink,
} from "@/lib/schemas"
import type { Appointment } from "./agenda-utils"

interface AppointmentCardProps {
  appointment: Appointment
  isOpen: boolean
  onToggle: () => void
  onEditAppointment?: (appointment: Appointment) => void
  onPay: (appointment: Appointment) => void
  onWhatsApp: (appointment: Appointment) => void
  onCancel: (appointment: Appointment) => void
}

export function AppointmentCard({
  appointment: appt,
  isOpen,
  onToggle,
  onEditAppointment,
  onPay,
  onWhatsApp,
  onCancel,
}: AppointmentCardProps) {
  const hasHealthAlert = !!appt.patient.healthNotes?.trim()
  const isCancelled = appt.status === "cancelled"
  const isPaid = appt.status === "paid"
  const whatsAppLink = getWhatsAppLink(appt.patient.phone)

  return (
    <div
      className={`relative group cursor-pointer rounded-lg border p-2 hover:shadow-md transition-shadow ${
        hasHealthAlert ? "border-amber-300 bg-amber-50/40" : "border-gray-200 bg-white"
      }`}
      onClick={onToggle}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <User className="h-4 w-4 text-gray-400 shrink-0" />
          <span className="text-sm font-medium text-gray-900 truncate">
            {appt.patient.fullName}
          </span>
          {hasHealthAlert && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
              title={appt.patient.healthNotes || "Alerta de saúde"}
            >
              <HeartPulse className="h-3 w-3" />
              Saúde
            </span>
          )}
        </div>
        <Badge className={STATUS_COLORS[appt.status]}>{STATUS_LABELS[appt.status]}</Badge>
      </div>

      {/* Alerta de saúde sempre visível (compacto) */}
      {hasHealthAlert && !isOpen && (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-700">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span className="line-clamp-1">{appt.patient.healthNotes}</span>
        </p>
      )}

      {/* Detalhes expandidos */}
      {isOpen && (
        <div
          className="mt-2 pt-2 border-t border-gray-100 space-y-2"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <DollarSign className="h-3 w-3 shrink-0" />
            <span>{formatCurrency(appt.totalAmount || 0)}</span>
            {appt.procedures.length > 0 && (
              <>
                <span>•</span>
                <span className="truncate">
                  {appt.procedures.map((p) => p.procedureNameSnapshot).join(", ")}
                </span>
              </>
            )}
          </div>

          {hasHealthAlert && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              <HeartPulse className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Alerta de saúde</p>
                <p>{appt.patient.healthNotes}</p>
              </div>
            </div>
          )}

          {/* Ações rápidas */}
          <div className="flex flex-wrap gap-1.5">
            {!isCancelled && !isPaid && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => onPay(appt)}
              >
                <CreditCard className="h-3.5 w-3.5 mr-1" />
                Registrar pagamento
              </Button>
            )}

            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs text-green-700 hover:text-green-800"
              disabled={!whatsAppLink}
              title={
                whatsAppLink
                  ? "Abrir conversa no WhatsApp"
                  : "Paciente sem telefone cadastrado"
              }
              onClick={() => onWhatsApp(appt)}
            >
              <MessageCircle className="h-3.5 w-3.5 mr-1" />
              WhatsApp
            </Button>

            {onEditAppointment && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => onEditAppointment(appt)}
              >
                Editar
              </Button>
            )}

            {!isCancelled && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-red-600 hover:text-red-700"
                onClick={() => onCancel(appt)}
              >
                <Ban className="h-3.5 w-3.5 mr-1" />
                Cancelar
              </Button>
            )}
          </div>

          {!whatsAppLink && (
            <p className="text-[11px] text-gray-400">
              Cadastre um telefone para habilitar o WhatsApp.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
