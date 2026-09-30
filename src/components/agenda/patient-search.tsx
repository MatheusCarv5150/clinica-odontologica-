"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Search, Plus, Loader2, User, Calendar } from "lucide-react"

interface Patient {
  id: string
  fullName: string
  cpf: string
  birthDate: string
  healthNotes?: string | null
}

interface PatientSearchProps {
  onSelectPatient: (patient: Patient) => void
  onNewPatient: (initialName?: string) => void
  selectedPatient?: Patient | null
}

export function PatientSearch({ onSelectPatient, onNewPatient, selectedPatient }: PatientSearchProps) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Patient[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const handleSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 1) {
      setResults([])
      return
    }

    setIsSearching(true)
    try {
      const res = await fetch(`/api/patients/search?q=${encodeURIComponent(searchQuery)}&pageSize=20`)
      if (res.ok) {
        const data = await res.json()
        setResults(data.patients || data)
        setShowResults(true)
      }
    } catch {
      console.error("Erro na busca:")
    } finally {
      setIsSearching(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    debounceRef.current = setTimeout(() => {
      if (query.trim().length >= 1) {
        handleSearch(query)
      }
    }, 300)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [query, handleSearch])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  function formatCPF(cpf: string): string {
    const cleaned = cpf.replace(/\D/g, "")
    if (cleaned.length !== 11) return cpf
    return `${cleaned.slice(0, 3)}.${cleaned.slice(3, 6)}.${cleaned.slice(6, 9)}-${cleaned.slice(9)}`
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr)
    return date.toLocaleDateString("pt-BR")
  }

  if (selectedPatient) {
    return (
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
                <User className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="font-medium text-blue-900">{selectedPatient.fullName}</p>
                <p className="text-sm text-blue-600">
                  {formatCPF(selectedPatient.cpf)} • {formatDate(selectedPatient.birthDate)}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSelectPatient(null as unknown as Patient)}
            >
              Trocar
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div ref={searchRef} className="relative">
      <Label className="mb-2 block">Buscar Paciente</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Digite nome ou CPF do paciente..."
            className="pl-10"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setShowResults(true)}
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />
          )}
        </div>
        <Button variant="outline" onClick={() => onNewPatient(query)} title="Novo paciente">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Novo</span>
        </Button>
      </div>

      {showResults && results.length > 0 && (
        <Card className="absolute z-50 mt-1 w-full shadow-lg">
          <CardContent className="p-2">
            {results.map((patient) => (
              <button
                key={patient.id}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-blue-50"
                onClick={() => {
                  onSelectPatient(patient)
                  setShowResults(false)
                  setQuery("")
                }}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100">
                  <User className="h-4 w-4 text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {patient.fullName}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatCPF(patient.cpf)}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <Calendar className="h-3 w-3" />
                  {formatDate(patient.birthDate)}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {showResults && query.length >= 1 && results.length === 0 && !isSearching && (
        <Card className="absolute z-50 mt-1 w-full shadow-lg">
          <CardContent className="p-4 text-center text-sm text-gray-500">
            Nenhum paciente encontrado.
            <Button
              variant="ghost"
              className="ml-1 h-auto p-0 text-sm text-blue-600 hover:text-blue-800"
              onClick={() => onNewPatient(query)}
            >
              Cadastrar novo paciente
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}