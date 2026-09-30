"use client"

import { useState } from "react"
import { AgendaGrid } from "@/components/agenda/agenda-grid"
import { AppointmentForm } from "@/components/agenda/appointment-form"
import { EditAppointmentModal } from "@/components/agenda/edit-appointment-modal"
import type { Appointment } from "@/components/agenda/agenda-utils"

export default function AgendaPage() {
  const [showNewAppointment, setShowNewAppointment] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string>("")
  const [editingAppointment, setEditingAppointment] =
    useState<Appointment | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  function handleNewAppointment(date?: string) {
    setSelectedDate(date || "")
    setShowNewAppointment(true)
  }

  function handleSuccess() {
    setShowNewAppointment(false)
    setEditingAppointment(null)
    setRefreshKey((k) => k + 1)
  }

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white">
        <div className="flex h-16 items-center justify-between px-6">
          <h1 className="text-lg font-semibold text-gray-900">Agenda</h1>
        </div>
      </header>

      <main className="p-6">
        <AgendaGrid
          key={refreshKey}
          onNewAppointment={handleNewAppointment}
          onEditAppointment={(appt) => setEditingAppointment(appt)}
        />
      </main>

      {/* Modal de novo agendamento */}
      {showNewAppointment && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 pt-10">
          <div className="relative w-full max-w-2xl mx-auto mb-10">
            <div className="rounded-xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Novo Agendamento
                </h2>
                <button
                  className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  onClick={() => setShowNewAppointment(false)}
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-6">
                <AppointmentForm
                  onSuccess={handleSuccess}
                  selectedDate={selectedDate}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Edição de Agendamento */}
      {editingAppointment && (
        <EditAppointmentModal
          appointment={editingAppointment}
          onClose={() => setEditingAppointment(null)}
          onSuccess={handleSuccess}
        />
      )}
    </>
  )
}