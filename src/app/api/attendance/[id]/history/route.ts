import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { normalizeTime } from "@/lib/date-utils"
import {
  buildProfessionalIndex,
  resolveProfessional,
} from "@/lib/attendance-professional-resolver"

export const dynamic = "force-dynamic"

// GET /api/attendance/[id]/history?page=1&pageSize=5&from=&to=&professionalId=&status=
//
// Histórico do PACIENTE dono do atendimento informado.
//
// Segurança / isolamento (LGPD):
// - O paciente NUNCA é recebido por parâmetro. O backend resolve o paciente a
//   partir do atendimento (id) e filtra o histórico exclusivamente por ele.
//   Assim, não há como obter dados de outro paciente alterando IDs na URL.
// - O atendimento precisa existir; caso contrário, 404. Não retornamos dados
//   de outros pacientes nem confirmamos a existência de IDs alheios.
//
// Integridade histórica:
// - O nome/valor dos procedimentos vêm do SNAPSHOT gravado no atendimento
//   (procedureNameSnapshot), preservando o passado mesmo que o catálogo atual
//   de procedures seja renomeado ou tenha o preço alterado.
//
// Performance:
// - Uma única query paginada com os relacionamentos necessários (sem N+1).
//   O atendimento atual é buscado separadamente por ser um único registro.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { error: "Identificador do atendimento não informado." },
        { status: 400 }
      )
    }

    const { searchParams } = new URL(request.url)

    // Paginação com limites rígidos: o histórico nunca é carregado inteiro.
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1)
    const pageSize = Math.min(
      50,
      Math.max(1, parseInt(searchParams.get("pageSize") || "5", 10) || 5)
    )

    const statusFilter = (searchParams.get("status") || "").trim()
    const fromParam = (searchParams.get("from") || "").trim()
    const toParam = (searchParams.get("to") || "").trim()
    const professionalId = (searchParams.get("professionalId") || "").trim()

    // 1) Resolver o paciente a partir do atendimento (fonte confiável) e já
    //    carregar os dados do próprio atendimento atual para o bloco destacado.
    const current = await prisma.appointment.findUnique({
      where: { id },
      select: {
        id: true,
        patientId: true,
        appointmentDate: true,
        appointmentTime: true,
        status: true,
        notes: true,
        // Vínculo com o cadastro de profissionais e identidade congelada.
        finishedById: true,
        finishedByName: true,
        evolutionRecord: {
          select: {
            id: true,
            chiefComplaint: true,
            clinicalFindings: true,
            evaluation: true,
            conduct: true,
            evolution: true,
            guidance: true,
            intercurrentHas: true,
            intercurrentDesc: true,
            observations: true,
            finalized: true,
            finalizedAt: true,
            finalizedByName: true,
            createdById: true,
            createdByName: true,
            createdAt: true,
            updatedAt: true,
            procedureRecords: {
              select: {
                id: true,
                procedureId: true,
                procedureNameSnapshot: true,
                toothNumber: true,
                dentition: true,
                surfaces: true,
                status: true,
                material: true,
                notes: true,
                professionalName: true,
                occurredAt: true,
              },
              orderBy: { occurredAt: "asc" },
            },
          },
        },
        patient: { select: { id: true, fullName: true } },
        procedures: {
          select: {
            id: true,
            procedureNameSnapshot: true,
            quantity: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    })
    if (!current) {
      return NextResponse.json(
        { error: "Atendimento não encontrado." },
        { status: 404 }
      )
    }

    const patientId = current.patientId

    // 2) Montar o filtro SEMPRE ancorado no paciente resolvido no servidor.
    const where: Record<string, unknown> = { patientId }

    if (statusFilter && statusFilter !== "all") {
      // Permite agrupar "aguardando atendimento" (paid + awaiting_attendance)
      // sem duplicar a regra de status no frontend.
      where.status =
        statusFilter === "awaiting_attendance"
          ? { in: ["paid", "awaiting_attendance"] }
          : statusFilter
    }

    if (fromParam || toParam) {
      const range: Record<string, Date> = {}
      if (fromParam) {
        const from = new Date(`${fromParam}T00:00:00.000Z`)
        if (!Number.isNaN(from.getTime())) range.gte = from
      }
      if (toParam) {
        const to = new Date(`${toParam}T23:59:59.999Z`)
        if (!Number.isNaN(to.getTime())) range.lte = to
      }
      if (Object.keys(range).length > 0) {
        where.appointmentDate = range
      }
    }

    // Filtro por profissional: o vínculo acontece pelo snapshot de finalização
    // (`finished_by_id`). Sem vínculo persistido, o filtro não é aplicável ao
    // agendamento — por isso ele é aceito pela API mas ignorado aqui.
    void professionalId

    // 3) Histórico paginado do paciente. O atendimento atual é excluído da
    //    listagem histórica e apresentado em bloco próprio pelo frontend.
    const historyWhere = { ...where, id: { not: current.id } }

    const [total, rows] = await Promise.all([
      prisma.appointment.count({ where: historyWhere }),
      prisma.appointment.findMany({
        where: historyWhere,
        orderBy: [
          { appointmentDate: "desc" },
          { appointmentTime: "desc" },
          { createdAt: "desc" },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          appointmentDate: true,
          appointmentTime: true,
          status: true,
          notes: true,
          // Vínculo com o cadastro de profissionais (quando a finalização foi
          // feita por um profissional registrado) e identidade congelada.
          finishedById: true,
          finishedByName: true,
          evolutionRecord: {
            select: {
              id: true,
              chiefComplaint: true,
              clinicalFindings: true,
              evaluation: true,
              conduct: true,
              evolution: true,
              guidance: true,
              intercurrentHas: true,
              intercurrentDesc: true,
              observations: true,
              finalized: true,
              finalizedAt: true,
              finalizedByName: true,
              createdById: true,
              createdByName: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          procedures: {
            select: {
              id: true,
              procedureNameSnapshot: true,
              quantity: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
      }),
    ])

    // Índice de profissionais por id E por nome normalizado, montado em UMA
    // consulta para resolver a identidade VIVA de toda a página sem N+1.
    // Cobre atendimentos legados (finalizados antes de existir o vínculo por
    // id), que só têm o nome congelado como pista. O atendimento atual entra
    // no índice junto com as linhas do histórico.
    const professionalIndex = await buildProfessionalIndex([...rows, current])

    // 4) Indicadores do histórico (sem trazer registros adicionais).
    const [totalAll, completedAll, lastDone] = await Promise.all([
      prisma.appointment.count({ where: { patientId } }),
      prisma.appointment.count({
        where: { patientId, status: "completed" },
      }),
      prisma.appointment.findFirst({
        where: { patientId, status: "completed", id: { not: current.id } },
        orderBy: [{ appointmentDate: "desc" }, { appointmentTime: "desc" }],
        select: { appointmentDate: true },
      }),
    ])

    const items = rows.map((row) => ({
      id: row.id,
      date: row.appointmentDate,
      time: normalizeTime(row.appointmentTime),
      status: row.status,
      isCurrent: false,
      procedures: row.procedures.map((p) => ({
        id: p.id,
        name: p.procedureNameSnapshot,
        quantity: p.quantity,
      })),
      // Profissional responsável resolvido do cadastro (ou pela identidade
      // textual congelada quando não há vínculo).
      professional: resolveProfessional(professionalIndex, row),
      // Observação do atendimento (anotação do registro) e evolução clínica
      // são conceitos distintos e permanecem separados.
      notes: row.notes,
      evolution: row.evolutionRecord,
    }))

    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const hasMore = page * pageSize < total

    return NextResponse.json({
      patient: {
        id: current.patient.id,
        fullName: current.patient.fullName,
      },
      // Atendimento atual identificado separadamente — nunca listado como
      // histórico concluído. Pertence ao mesmo paciente por construção.
      current: {
        id: current.id,
        date: current.appointmentDate,
        time: normalizeTime(current.appointmentTime),
        status: current.status,
        isCurrent: true,
        procedures: current.procedures.map((p) => ({
          id: p.id,
          name: p.procedureNameSnapshot,
          quantity: p.quantity,
        })),
        professional: resolveProfessional(professionalIndex, current),
        notes: current.notes,
        evolution: current.evolutionRecord,
      },
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasMore,
      },
      summary: {
        total: totalAll,
        completed: completedAll,
        lastVisit: lastDone?.appointmentDate ?? null,
      },
    })
  } catch (error) {
    console.error("Erro ao carregar histórico do paciente:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}
