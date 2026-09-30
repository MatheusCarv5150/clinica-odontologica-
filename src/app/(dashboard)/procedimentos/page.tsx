"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ProcedureFormModal } from "@/components/procedimentos/procedure-form-modal"
import { Search, Plus, Syringe, ChevronLeft, ChevronRight, Loader2, ToggleLeft, ToggleRight, Pencil } from "lucide-react"
import { formatCurrency } from "@/lib/schemas"

interface Procedure {
  id: string
  name: string
  category: string
  code: string
  defaultPrice: number | null
  allowPriceOverride: boolean
  description: string | null
  active: boolean
  createdAt: string
  updatedAt: string
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export default function ProcedimentosPage() {
  const [query, setQuery] = useState("")
  const [procedures, setProcedures] = useState<Procedure[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [hasSearched, setHasSearched] = useState(false)
  const [searchError, setSearchError] = useState("")
  const [showNewProcedure, setShowNewProcedure] = useState(false)
  const [editingProcedure, setEditingProcedure] = useState<Procedure | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const handleSearch = useCallback(async (page = 1) => {
    const trimmedQuery = query.trim()
    if (!trimmedQuery) {
      setSearchError("Digite um nome ou código para pesquisar.")
      return
    }

    setIsSearching(true)
    setSearchError("")
    setHasSearched(true)

    try {
      const res = await fetch(
        `/api/procedures?q=${encodeURIComponent(trimmedQuery)}&page=${page}&pageSize=20&includeInactive=true`
      )
      if (res.ok) {
        const data = await res.json()
        setProcedures(data.procedures)
        setPagination(data.pagination)
        if (data.procedures.length === 0) {
          setSearchError("Nenhum procedimento encontrado.")
        }
      } else {
        const err = await res.json()
        setSearchError(err.error || "Erro ao pesquisar")
        setProcedures([])
        setPagination(null)
      }
    } catch {
      setSearchError("Erro de conexão. Tente novamente.")
      setProcedures([])
      setPagination(null)
    } finally {
      setIsSearching(false)
    }
  }, [query])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      handleSearch()
    }
  }

  async function handleNewProcedureSuccess() {
    setShowNewProcedure(false)
    setEditingProcedure(null)
    reloadProcedures()
  }

  function handleEditSuccess() {
    setEditingProcedure(null)
    reloadProcedures()
  }

  function openEdit(procedure: Procedure) {
    setEditingProcedure(procedure)
  }

  async function reloadProcedures() {
    // Recarrega usando a query atual ou a lista completa
    if (query.trim()) {
      handleSearch()
    } else {
      try {
        const res = await fetch("/api/procedures")
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data)) {
            setProcedures(data)
          }
        }
      } catch {
        // Silencia
      }
    }
  }

  async function handleToggleActive(procedure: Procedure) {
    const newActive = !procedure.active
    const action = newActive ? "ativar" : "desativar"

    if (!newActive) {
      if (!confirm(`Tem certeza que deseja desativar este procedimento?\n\nEle não estará disponível para novos agendamentos, mas continuará presente no histórico.`)) {
        return
      }
    } else {
      if (!confirm(`Tem certeza que deseja ativar este procedimento?\n\nEle voltará a ficar disponível para novos agendamentos.`)) {
        return
      }
    }

    try {
      const res = await fetch(`/api/procedures/${procedure.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: procedure.name,
          category: procedure.category,
          code: procedure.code,
          defaultPrice: procedure.defaultPrice || 0,
          allowPriceOverride: procedure.allowPriceOverride,
          description: procedure.description || "",
          active: newActive,
        }),
      })

      if (res.ok) {
        reloadProcedures()
      } else {
        const err = await res.json()
        alert(err.error || `Erro ao ${action} procedimento`)
      }
    } catch {
      alert(`Erro ao ${action} procedimento`)
    }
  }

  // Carregar procedimentos iniciais
  useEffect(() => {
    let cancelled = false
    fetch("/api/procedures")
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        if (!cancelled && Array.isArray(data)) {
          setProcedures(data)
          if (data.length > 0) setHasSearched(true)
        }
      })
      .catch(err => console.error("Erro ao carregar procedimentos:", err))
      .finally(() => { if (!cancelled) setInitialLoading(false) })
    return () => { cancelled = true }
  }, [])

  function getCategoryColor(category: string): string {
    const colors: Record<string, string> = {
      "Consulta / Avaliação": "bg-blue-100 text-blue-700",
      "Prevenção": "bg-green-100 text-green-700",
      "Restauração": "bg-amber-100 text-amber-700",
      "Cirurgia": "bg-red-100 text-red-700",
      "Estética": "bg-pink-100 text-pink-700",
      "Ortodontia": "bg-indigo-100 text-indigo-700",
      "Radiologia": "bg-purple-100 text-purple-700",
      "Prótese": "bg-teal-100 text-teal-700",
      "Endodontia": "bg-orange-100 text-orange-700",
      "Periodontia": "bg-cyan-100 text-cyan-700",
      "Outros": "bg-gray-100 text-gray-700",
    }
    return colors[category] || "bg-gray-100 text-gray-700"
  }

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white">
        <div className="flex h-16 items-center justify-between px-6">
          <h1 className="text-lg font-semibold text-gray-900">Procedimentos</h1>
          <Button onClick={() => setShowNewProcedure(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Novo Procedimento
          </Button>
        </div>
      </header>

      <main className="p-6">
        {/* Barra de pesquisa */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label
                  htmlFor="search-input"
                  className="mb-1.5 block text-sm font-medium text-gray-700"
                >
                  Pesquisar procedimento
                </label>
                <Input
                  id="search-input"
                  ref={searchInputRef}
                  placeholder="Nome do procedimento"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full"
                />
              </div>
              <Button
                onClick={() => handleSearch()}
                disabled={isSearching}
                className="mb-0"
              >
                {isSearching ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Pesquisar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Loading inicial */}
        {initialLoading && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-gray-400" />
            <h3 className="mt-4 text-lg font-medium text-gray-900">
              Carregando procedimentos...
            </h3>
          </div>
        )}

        {/* Estado inicial - nenhuma pesquisa */}
        {!initialLoading && !hasSearched && !isSearching && !searchError && procedures.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Syringe className="h-16 w-16 text-gray-300" />
            <h3 className="mt-4 text-lg font-medium text-gray-900">
              Gerencie seus procedimentos
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Cadastre os procedimentos oferecidos pela clínica.
            </p>
          </div>
        )}

        {/* Mensagem de erro */}
        {searchError && !isSearching && procedures.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Syringe className="h-16 w-16 text-gray-300" />
            <h3 className="mt-4 text-lg font-medium text-gray-900">
              {searchError}
            </h3>
            {searchError === "Nenhum procedimento encontrado." && (
              <>
                <p className="mt-1 text-sm text-gray-500">
                  Tente outro nome ou código, ou cadastre um novo procedimento.
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => setShowNewProcedure(true)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Cadastrar novo procedimento
                </Button>
              </>
            )}
          </div>
        )}

        {/* Resultados */}
        {hasSearched && !isSearching && procedures.length > 0 && (
          <>
            {/* Total de resultados */}
            {pagination && (
              <p className="mb-4 text-sm text-gray-500">
                {pagination.total === 1
                  ? "1 procedimento encontrado"
                  : `${pagination.total} procedimentos encontrados`}
                {pagination.totalPages > 1 && ` (página ${pagination.page} de ${pagination.totalPages})`}
              </p>
            )}

            {/* Tabela de procedimentos */}
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Procedimento
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Categoria
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Código
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Valor
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Status
                    </th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {procedures.map((procedure) => (
                    <tr key={procedure.id} className="hover:bg-gray-50 transition-colors">
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                            <Syringe className="h-4 w-4 text-blue-600" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{procedure.name}</p>
                            {procedure.description && (
                              <p className="text-xs text-gray-500 truncate max-w-[200px]">{procedure.description}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <Badge className={getCategoryColor(procedure.category)}>
                          {procedure.category}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span className="text-sm font-mono text-gray-600">{procedure.code}</span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span className="text-sm font-medium text-gray-900">
                          {formatCurrency(procedure.defaultPrice || 0)}
                        </span>
                        {!procedure.allowPriceOverride && (
                          <span className="ml-2 text-[10px] text-gray-400">(fixo)</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <Badge variant={procedure.active ? "success" : "danger"}>
                          {procedure.active ? "Ativo" : "Inativo"}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(procedure)}
                          >
                            <Pencil className="h-4 w-4 mr-1" />
                            Editar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleActive(procedure)}
                            className={procedure.active ? "text-red-600 hover:text-red-700" : "text-green-600 hover:text-green-700"}
                          >
                            {procedure.active ? (
                              <ToggleRight className="h-4 w-4 mr-1" />
                            ) : (
                              <ToggleLeft className="h-4 w-4 mr-1" />
                            )}
                            {procedure.active ? "Desativar" : "Ativar"}
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
                  onClick={() => handleSearch(pagination.page - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </Button>

                <div className="flex items-center gap-1">
                  {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
                    .filter((p) => {
                      const page = pagination.page
                      return (
                        p === 1 ||
                        p === pagination.totalPages ||
                        Math.abs(p - page) <= 1
                      )
                    })
                    .reduce<(number | string)[]>((acc, p, idx, arr) => {
                      if (idx > 0 && arr[idx - 1] !== p - 1) {
                        acc.push("...")
                      }
                      acc.push(p)
                      return acc
                    }, [])
                    .map((item, idx) =>
                      typeof item === "string" ? (
                        <span key={`ellipsis-${idx}`} className="px-2 text-sm text-gray-400">
                          ...
                        </span>
                      ) : (
                        <Button
                          key={item}
                          variant={item === pagination.page ? "default" : "outline"}
                          size="sm"
                          className="min-w-[36px]"
                          onClick={() => handleSearch(item as number)}
                        >
                          {item}
                        </Button>
                      )
                    )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => handleSearch(pagination.page + 1)}
                >
                  Próximo
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Modal de novo procedimento */}
      {showNewProcedure && (
        <ProcedureFormModal
          onSuccess={handleNewProcedureSuccess}
          onCancel={() => setShowNewProcedure(false)}
        />
      )}

      {/* Modal de edição */}
      {editingProcedure && (
        <ProcedureFormModal
          onSuccess={handleEditSuccess}
          onCancel={() => setEditingProcedure(null)}
          initialData={editingProcedure}
        />
      )}
    </>
  )
}