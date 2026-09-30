import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { ATTENDANCE_QUEUE_STATUSES } from "@/lib/schemas"
import { calculateAge, getDayRange, normalizeTime, todayKey } from "@/lib/date-utils"

export const dynamic = "force-dynamic"

interface QueueItem {
  id: string
  appointmentTime: string | null
  status: string
  patient: {
    id: string
    fullName: string
    cpf: string
    phone: string | null
    age: number | null
    hasHealthAlert: boolean
  }
  procedures: Array<{
    id: string
    name: string
    quantity: number
  }>
}

// GET /api/attendance?date=YYYY-MM-DD&q=termo&status=paid
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const dateParam = searchParams.get("date") || todayKey()
    const query = (searchParams.get("q") || "").trim()
    const statusFilter = searchParams.get("status")

    let range: { start: Date; end: Date }
    try {
      range = getDayRange(dateParam)
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Data inválida" },
        { status: 400 }
      )
    }

    // Base: todos os agendamentos do dia (permite calcular o resumo completo,
    // incluindo quantos foram concluídos no dia).
    const appointments = await prisma.appointment.findMany({
      where: {
        appointmentDate: { gte: range.start, lte: range.end },
      },
      include: {
        patient: {
          select: {
            id: true,
            fullName: true,
            cpf: true,
            phone: true,
            birthDate: true,
            healthNotes: true,
          },
        },
        procedures: {
          select: {
            id: true,
            procedureNameSnapshot: true,
            quantity: true,
          },
        },
      },
      orderBy: [{ appointmentTime: "asc" }],
    })

    // Resumo (indicadores) — sempre calculado sobre o dia inteiro,
    // independentemente de busca/filtro aplicados na listagem.
    const inQueue = appointments.filter((a) =>
      (ATTENDANCE_QUEUE_STATUSES as readonly string[]).includes(a.status)
    )

    const summary = {
      released: inQueue.filter((a) =>
        ["paid", "awaiting_attendance"].includes(a.status)
      ).length,
      awaiting: inQueue.filter((a) => a.status === "paid").length,
      inProgress: inQueue.filter((a) => a.status === "in_progress").length,
      completed: inQueue.filter((a) => a.status === "completed").length,
    }

    // Busca em backend (nome ou CPF), respeitando a estratégia usada na
    // tela de Pacientes.
    const normalize = (value: string) =>
      value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
    const digitsQuery = query.replace(/\D/g, "")
    const normalizedQuery = normalize(query)

    let queue = inQueue

    if (statusFilter && statusFilter !== "all") {
      if (statusFilter === "awaiting_attendance") {
        queue = queue.filter((a) =>
          ["paid", "awaiting_attendance"].includes(a.status)
        )
      } else {
        queue = queue.filter((a) => a.status === statusFilter)
      }
    }

    if (query) {
      queue = queue.filter((a) => {
        const nameMatch = normalize(a.patient.fullName).includes(normalizedQuery)
        const cpfMatch =
          digitsQuery.length > 0 && a.patient.cpf.includes(digitsQuery)
        return nameMatch || cpfMatch
      })
    }

    const items: QueueItem[] = queue.map((a) => {
      const time = normalizeTime(a.appointmentTime)
      const hasHealthAlert = !!a.patient.healthNotes?.trim()

      return {
        id: a.id,
        appointmentTime: time,
        status: a.status,
        patient: {
          id: a.patient.id,
          fullName: a.patient.fullName,
          cpf: a.patient.cpf,
          phone: a.patient.phone,
          age: calculateAge(a.patient.birthDate),
          hasHealthAlert,
        },
        procedures: a.procedures.map((p) => ({
          id: p.id,
          name: p.procedureNameSnapshot,
          quantity: p.quantity,
        })),
      }
    })

    // Ordenação cronológica; registros sem horário válido vão para o fim.
    // O horário já vem normalizado em "HH:MM", então a comparação de string
    // é suficiente e estável.
    items.sort((a, b) => {
      const aKey = a.appointmentTime || "99:99"
      const bKey = b.appointmentTime || "99:99"
      if (aKey === bKey) {
        return a.patient.fullName.localeCompare(b.patient.fullName, "pt-BR")
      }
      return aKey < bKey ? -1 : 1
    })

    return NextResponse.json({
      date: dateParam,
      summary,
      items,
    })
  } catch (error) {
    console.error("Erro ao carregar fila de atendimento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}
