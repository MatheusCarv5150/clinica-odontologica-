"use client"

import { useState, useCallback, useRef, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PatientDetailsPanel } from "@/components/pacientes/patient-details-panel"
import { PatientFormModal } from "@/components/pacientes/patient-form-modal"
import { Search, Plus, Users, AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from "lucide-react"

interface Patient {
  id: string
  fullName: string
  cpf: string
  birthDate: string
  healthNotes: string | null
  _count: { appointments: number }
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

// Paciente no formato aceito pelo modal de edição. Mantém o contrato mínimo
// compartilhado com PatientFormModal, sem recorrer a `any`.
export interface PatientEditable {
  id?: string
  fullName?: string
  cpf?: string
  phone?: string | null
  birthDate?: string
  healthNotes?: string | null
}

function formatCPF(cpf: string): string {
  const cleaned = cpf.replace(/\D/g, "")
  if (cleaned.length !== 11) return cpf
  return `${cleaned.slice(0, 3)}.${cleaned.slice(3, 6)}.${cleaned.slice(6, 9)}-${cleaned.slice(9)}`
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString("pt-BR")
}

export default function PacientesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20 text-sm text-gray-400">
          Carregando...
        </div>
      }
    >
      <PacientesContent />
    </Suspense>
  )
}

function PacientesContent() {
  const [query, setQuery] = useState("")
  const [patients, setPatients] = useState<Patient[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [searchError, setSearchError] = useState("")
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null)
  const [showNewPatient, setShowNewPatient] = useState(false)
  const [editingPatient, setEditingPatient] = useState<PatientEditable | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchParams = useSearchParams()

  const handleSearch = useCallback(async (page = 1) => {
    const trimmedQuery = query.trim()
    if (!trimmedQuery) {
      setSearchError("Digite um nome ou CPF para pesquisar.")
      return
    }

    setIsSearching(true)
    setSearchError("")
    setHasSearched(true)

    try {
      const res = await fetch(
        `/api/patients/search?q=${encodeURIComponent(trimmedQuery)}&page=${page}&pageSize=20`
      )
      if (res.ok) {
        const data = await res.json()
        setPatients(data.patients)
        setPagination(data.pagination)
        if (data.patients.length === 0) {
          setSearchError("Nenhum paciente encontrado.")
        }
      } else {
        const err = await res.json()
        setSearchError(err.error || "Erro ao pesquisar")
        setPatients([])
        setPagination(null)
      }
    } catch {
      setSearchError("Erro de conexão. Tente novamente.")
      setPatients([])
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

  function handleNewPatientSuccess() {
    setShowNewPatient(false)
    setEditingPatient(null)
    // Se pesquisou recentemente, faz uma nova pesquisa para atualizar a lista
    if (hasSearched) {
      handleSearch()
    }
  }

  function handleEditSuccess() {
    setEditingPatient(null)
    // Atualiza os detalhes se estiver aberto
    setSelectedPatientId(null)
    if (hasSearched) {
      handleSearch()
    }
  }

  function openEditFromDetails(patient: PatientEditable) {
    setSelectedPatientId(null)
    setEditingPatient(patient)
  }

  // Abertura direta do cadastro via URL (ex.: "Ver cadastro do paciente"
  // a partir do cabeçalho do atendimento). Não cria tela nova: apenas abre o
  // painel de detalhes já existente.
  //
  // O valor da URL é usado como estado DERIVADO durante a renderização, em vez
  // de sincronizado por efeito: evita renders em cascata e mantém o painel
  // consistente quando o parâmetro muda. Ao fechar, limpamos o estado local.
  const patientIdFromUrl = searchParams.get("patient")
  const detailsPatientId = selectedPatientId ?? patientIdFromUrl

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white">
        <div className="flex h-16 items-center justify-between px-6">
          <h1 className="text-lg font-semibold text-gray-900">Pacientes</h1>
          <Button onClick={() => setShowNewPatient(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Novo Paciente
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
                  Pesquisar paciente
                </label>
                <Input
                  id="search-input"
                  ref={searchInputRef}
                  placeholder="Nome ou CPF"
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

        {/* Estado inicial - nenhuma pesquisa */}
        {!hasSearched && !isSearching && !searchError && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Users className="h-16 w-16 text-gray-300" />
            <h3 className="mt-4 text-lg font-medium text-gray-900">
              Pesquise um paciente
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Digite o nome ou CPF acima e clique em Pesquisar.
            </p>
          </div>
        )}

        {/* Mensagem de erro */}
        {searchError && !isSearching && patients.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Users className="h-16 w-16 text-gray-300" />
            <h3 className="mt-4 text-lg font-medium text-gray-900">
              {searchError}
            </h3>
            {searchError === "Nenhum paciente encontrado." && (
              <>
                <p className="mt-1 text-sm text-gray-500">
                  Tente outro nome ou CPF, ou cadastre um novo paciente.
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => setShowNewPatient(true)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Cadastrar novo paciente
                </Button>
              </>
            )}
          </div>
        )}

        {/* Resultados */}
        {hasSearched && !isSearching && patients.length > 0 && (
          <>
            {/* Total de resultados */}
            {pagination && (
              <p className="mb-4 text-sm text-gray-500">
                {pagination.total === 1
                  ? "1 paciente encontrado"
                  : `${pagination.total} pacientes encontrados`}
                {pagination.totalPages > 1 && ` (página ${pagination.page} de ${pagination.totalPages})`}
              </p>
            )}

            {/* Lista de pacientes */}
            <div className="space-y-3">
              {patients.map((patient) => (
                <Card
                  key={patient.id}
                  className="cursor-pointer transition-colors hover:border-blue-200 hover:bg-blue-50/50"
                  onClick={() => setSelectedPatientId(patient.id)}
                >
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900">{patient.fullName}</p>
                        {patient.healthNotes && (
                          <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                        <span>CPF: {formatCPF(patient.cpf)}</span>
                        <span>Nascimento: {formatDate(patient.birthDate)}</span>
                        <span>{patient._count.appointments} agendamento(s)</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedPatientId(patient.id)
                      }}
                    >
                      Visualizar
                    </Button>
                  </CardContent>
                </Card>
              ))}
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

      {/* Painel de detalhes */}
      {detailsPatientId && (
        <PatientDetailsPanel
          patientId={detailsPatientId}
          onClose={() => setSelectedPatientId(null)}
          onEdit={openEditFromDetails}
        />
      )}

      {/* Modal de novo paciente */}
      {showNewPatient && (
        <PatientFormModal
          onSuccess={handleNewPatientSuccess}
          onCancel={() => setShowNewPatient(false)}
        />
      )}

      {/* Modal de edição */}
      {editingPatient && (
        <PatientFormModal
          onSuccess={handleEditSuccess}
          onCancel={() => setEditingPatient(null)}
          initialData={editingPatient}
        />
      )}
    </>
  )
}