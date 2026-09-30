"use client"

// ===========================================================================
// PAINEL DE USUÁRIOS/PROFISSIONAIS — Configurações.
// ===========================================================================
//
// LISTAGEM SERVER-SIDE com busca, filtros e paginação. Nada de carregar todos
// os profissionais no cliente: cada interação refaz a consulta em
// `/api/professionals`.
//
// AÇÕES DISPONÍVEIS
//   - Novo usuário
//   - Visualizar (detalhes com os snapshots que serão gravados nos eventos)
//   - Editar
//   - Ativar / Inativar (nunca exclusão física quando há histórico)
//
// Esta tela NÃO é autenticação: é o cadastro da identidade profissional que o
// Atendimento passa a usar para identificar quem realizou/finalizou a ação.

import { useCallback, useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Search,
  Plus,
  UserCog,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Pencil,
  UserCheck,
  UserX,
} from "lucide-react"
import {
  ProfessionalFormModal,
  type ProfessionalEditable,
} from "@/components/configuracoes/professional-form-modal"
import { COUNCIL_TYPES } from "@/lib/professionals-domain"

interface ProfessionalRow {
  id: string
  fullName: string
  birthDate: string
  cpf: string
  cpfFormatted: string
  councilType: string
  councilNumber: string
  councilState: string | null
  councilLabel: string
  status: "active" | "inactive"
  statusLabel: string
  createdAt: string
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("pt-BR")
}

export function ProfessionalsPanel() {
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all")
  const [councilFilter, setCouncilFilter] = useState<string>("all")

  const [items, setItems] = useState<ProfessionalRow[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")
  const [feedback, setFeedback] = useState("")

  const [page, setPage] = useState(1)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ProfessionalEditable | null>(null)
  const [viewing, setViewing] = useState<ProfessionalRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Debounce da busca: evita uma requisição por tecla digitada.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
      setPage(1)
    }, 350)
    return () => clearTimeout(timer)
  }, [query])

  const load = useCallback(
    async (targetPage: number) => {
      // O primeiro setState precisa acontecer DEPOIS de um ponto de suspensão:
      // a regra `react-hooks/set-state-in-effect` proíbe setState síncrono no
      // corpo de um efeito (cascata de renders). O `await` inicial garante que
      // todo o trabalho deste loader seja assíncrono.
      await Promise.resolve()
      setIsLoading(true)
      setError("")
      try {
        const params = new URLSearchParams()
        params.set("page", String(targetPage))
        params.set("pageSize", "20")
        params.set("status", statusFilter)
        params.set("councilType", councilFilter)
        if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim())

        const res = await fetch(`/api/professionals?${params.toString()}`)
        const data = await res.json()

        if (!res.ok) {
          setError(data?.error || "Erro ao carregar profissionais.")
          setItems([])
          setPagination(null)
          return
        }

        setItems(data.items ?? [])
        setPagination({
          page: data.page,
          pageSize: data.pageSize,
          total: data.total,
          totalPages: data.totalPages,
        })
      } catch {
        setError("Erro de conexão. Tente novamente.")
        setItems([])
        setPagination(null)
      } finally {
        setIsLoading(false)
      }
    },
    [debouncedQuery, statusFilter, councilFilter]
  )

  useEffect(() => {
    // A chamada é adiada para fora do corpo síncrono do efeito: a regra
    // `react-hooks/set-state-in-effect` proíbe que o efeito provoque setState
    // de forma síncrona (isto é, cascata de renders). O timer de 0ms mantém o
    // carregamento imediato do ponto de vista do usuário.
    const timer = setTimeout(() => void load(page), 0)
    return () => clearTimeout(timer)
  }, [load, page])

  function refresh() {
    setShowForm(false)
    setEditing(null)
    setFeedback("")
    load(page)
  }

  async function toggleStatus(row: ProfessionalRow) {
    const next = row.status === "active" ? "inactive" : "active"
    setBusyId(row.id)
    setFeedback("")
    try {
      const res = await fetch(`/api/professionals/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || "Não foi possível alterar o status.")
        return
      }
      setFeedback(
        next === "inactive"
          ? `${row.fullName} foi inativado(a). O histórico permanece acessível.`
          : `${row.fullName} foi ativado(a) e já pode ser selecionado(a) em novos atendimentos.`
      )
      load(page)
    } catch {
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white">
        <div className="flex h-16 items-center justify-between px-6">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">
              Usuários e Profissionais
            </h1>
            <p className="text-xs text-gray-500">
              Gerencie os profissionais cadastrados e suas informações de identificação.
            </p>
          </div>
          <Button
            onClick={() => {
              setEditing(null)
              setShowForm(true)
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Novo usuário
          </Button>
        </div>
      </header>

      <main className="p-6">
        {/* Busca e filtros */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px] flex-1">
                <label
                  htmlFor="professional-search"
                  className="mb-1.5 block text-sm font-medium text-gray-700"
                >
                  Pesquisar
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input
                    id="professional-search"
                    placeholder="Nome, CPF ou conselho"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="status-filter"
                  className="mb-1.5 block text-sm font-medium text-gray-700"
                >
                  Status
                </label>
                <select
                  id="status-filter"
                  className="flex h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as "all" | "active" | "inactive")
                    setPage(1)
                  }}
                >
                  <option value="all">Todos</option>
                  <option value="active">Ativos</option>
                  <option value="inactive">Inativos</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="council-filter"
                  className="mb-1.5 block text-sm font-medium text-gray-700"
                >
                  Conselho
                </label>
                <select
                  id="council-filter"
                  className="flex h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={councilFilter}
                  onChange={(e) => {
                    setCouncilFilter(e.target.value)
                    setPage(1)
                  }}
                >
                  <option value="all">Todos</option>
                  {COUNCIL_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {feedback && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
            {feedback}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Carregando */}
        {isLoading && (
          <div className="flex items-center justify-center py-20 text-sm text-gray-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando profissionais...
          </div>
        )}

        {/* Vazio */}
        {!isLoading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <UserCog className="h-16 w-16 text-gray-300" />
            <h3 className="mt-4 text-lg font-medium text-gray-900">
              Nenhum profissional encontrado
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Ajuste a busca/filtros ou cadastre um novo usuário.
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => {
                setEditing(null)
                setShowForm(true)
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Cadastrar novo usuário
            </Button>
          </div>
        )}

        {/* Tabela */}
        {!isLoading && items.length > 0 && (
          <>
            {pagination && (
              <p className="mb-4 text-sm text-gray-500">
                {pagination.total === 1
                  ? "1 profissional encontrado"
                  : `${pagination.total} profissionais encontrados`}
                {pagination.totalPages > 1 &&
                  ` (página ${pagination.page} de ${pagination.totalPages})`}
              </p>
            )}

            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200 bg-gray-50">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-3">Nome completo</th>
                    <th className="px-4 py-3">CPF</th>
                    <th className="px-4 py-3">Conselho</th>
                    <th className="px-4 py-3">Número</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Criado em</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50/70">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {row.fullName}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{row.cpfFormatted}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {row.councilType}
                        {row.councilState ? `-${row.councilState}` : ""}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{row.councilNumber}</td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            row.status === "active"
                              ? "inline-flex rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700"
                              : "inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500"
                          }
                        >
                          {row.statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(row.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Visualizar"
                            onClick={() => setViewing(row)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Editar"
                            onClick={() => {
                              setEditing({
                                id: row.id,
                                fullName: row.fullName,
                                birthDate: row.birthDate,
                                cpf: row.cpf,
                                councilType: row.councilType,
                                councilNumber: row.councilNumber,
                                councilState: row.councilState,
                                status: row.status,
                              })
                              setShowForm(true)
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title={row.status === "active" ? "Inativar" : "Ativar"}
                            disabled={busyId === row.id}
                            onClick={() => toggleStatus(row)}
                          >
                            {busyId === row.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : row.status === "active" ? (
                              <UserX className="h-4 w-4 text-amber-600" />
                            ) : (
                              <UserCheck className="h-4 w-4 text-green-600" />
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paginação */}
            {pagination && pagination.totalPages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage(pagination.page - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </Button>
                <span className="px-3 text-sm text-gray-500">
                  Página {pagination.page} de {pagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage(pagination.page + 1)}
                >
                  Próxima
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Modal de cadastro/edição */}
      {showForm && (
        <ProfessionalFormModal
          onSuccess={refresh}
          onCancel={() => {
            setShowForm(false)
            setEditing(null)
          }}
          initialData={editing ?? undefined}
        />
      )}

      {/* Painel de detalhes */}
      {viewing && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 pt-10"
          onClick={() => setViewing(null)}
        >
          <div
            className="relative mx-auto mb-10 w-full max-w-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <Card>
              <CardContent className="space-y-4 p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-400">
                      Profissional
                    </p>
                    <h2 className="text-lg font-semibold text-gray-900">
                      {viewing.fullName}
                    </h2>
                    <p className="mt-1 text-sm text-gray-500">
                      {viewing.councilLabel}
                    </p>
                  </div>
                  <span
                    className={
                      viewing.status === "active"
                        ? "inline-flex rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700"
                        : "inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500"
                    }
                  >
                    {viewing.statusLabel}
                  </span>
                </div>

                <dl className="grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 text-sm">
                  <div>
                    <dt className="text-gray-400">CPF</dt>
                    <dd className="text-gray-900">{viewing.cpfFormatted}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">Data de nascimento</dt>
                    <dd className="text-gray-900">{formatDate(viewing.birthDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">Conselho</dt>
                    <dd className="text-gray-900">{viewing.councilType}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">Número</dt>
                    <dd className="text-gray-900">{viewing.councilNumber}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">UF do conselho</dt>
                    <dd className="text-gray-900">{viewing.councilState ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">Cadastrado em</dt>
                    <dd className="text-gray-900">{formatDate(viewing.createdAt)}</dd>
                  </div>
                </dl>

                <p className="rounded-lg bg-blue-50 p-3 text-xs text-blue-700">
                  Este é o snapshot de identificação gravado nos atendimentos
                  finalizados. Alterações cadastrais futuras não alteram o histórico
                  já registrado.
                </p>

                <div className="flex justify-end pt-2">
                  <Button variant="outline" onClick={() => setViewing(null)}>
                    Fechar
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
