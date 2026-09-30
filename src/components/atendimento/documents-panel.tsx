"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  FileImage,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAsyncData } from "@/lib/use-async-data"
import {
  DOCUMENT_CATEGORIES,
  getDocumentCategoryMeta,
  formatFileSize,
  isImageDocument,
  isPdfDocument,
} from "@/lib/document-domain"
import type {
  DocumentView,
  DocumentsApiResponse,
} from "@/lib/schemas-documents"
import { ToothSurfacePicker } from "./procedure-ui"

// ===========================================================================
// DOCUMENTOS / IMAGENS — Parte 10.3.
//
// Área de arquivos clínicos do paciente: radiografias, fotos, exames, PDFs.
// - Upload validado no servidor (tipo/tamanho), conteúdo em storage abstrato.
// - Vínculo com o atendimento e com o dente (mesma numeração do odontograma).
// - Exclusão LÓGICA (arquivamento) preservando o histórico clínico.
// ===========================================================================

interface DocumentsPanelProps {
  attendanceId: string
  onChanged?: () => void
}

export function DocumentsPanel({
  attendanceId,
  onChanged,
}: DocumentsPanelProps) {
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [showUpload, setShowUpload] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [preview, setPreview] = useState<DocumentView | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/attendance/${attendanceId}/documents`, {
      cache: "no-store",
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || "Não foi possível carregar os documentos.")
    }
    return (await res.json()) as DocumentsApiResponse
  }, [attendanceId])

  const {
    data,
    error: loadError,
    isLoading,
    reload,
  } = useAsyncData<DocumentsApiResponse>(load, [attendanceId])

  const filtered = useMemo(() => {
    if (!data) return []
    if (categoryFilter === "all") return data.documents
    return data.documents.filter((doc) => doc.category === categoryFilter)
  }, [data, categoryFilter])

  async function handleArchive(document: DocumentView) {
    if (
      !window.confirm(
        `Arquivar "${document.title}"? O documento deixará de aparecer na listagem, mas o histórico clínico é preservado.`
      )
    ) {
      return
    }
    setError("")
    setNotice("")
    try {
      const res = await fetch(
        `/api/attendance/${attendanceId}/documents/${document.id}`,
        { method: "DELETE" }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Não foi possível arquivar o documento.")
      }
      setNotice(`"${document.title}" arquivado (histórico preservado).`)
      await reload()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao arquivar.")
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-14 text-gray-400 shadow-sm">
        <Loader2 className="h-5 w-5 animate-spin" />
        Carregando documentos...
      </div>
    )
  }

  if (loadError || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-red-400" />
        <p className="mt-2 text-sm font-medium text-red-800">
          {loadError || "Não foi possível carregar os documentos."}
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={reload}>
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Documentos / Imagens</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            Radiografias, fotografias, exames e documentos clínicos do paciente.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Paciente: {data.patient.fullName}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowUpload(true)}
          className="shrink-0"
        >
          <Upload className="h-4 w-4" />
          Enviar arquivo
        </Button>
      </div>

      {/* Totalizadores */}
      <div className="grid grid-cols-3 gap-3">
        <MiniStat
          label="Total"
          value={data.totals.total}
          icon={<FileText className="h-4 w-4 text-gray-500" />}
        />
        <MiniStat
          label="Imagens"
          value={data.totals.images}
          icon={<FileImage className="h-4 w-4 text-blue-600" />}
        />
        <MiniStat
          label="PDFs"
          value={data.totals.pdfs}
          icon={<FileText className="h-4 w-4 text-red-600" />}
        />
      </div>

      {/* Feedback */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {notice}
        </div>
      )}

      {/* Filtro por categoria */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-gray-400" />
        <FilterChip
          label="Todos"
          active={categoryFilter === "all"}
          onClick={() => setCategoryFilter("all")}
        />
        {DOCUMENT_CATEGORIES.map((category) => {
          const count = data.totals.byCategory[category] ?? 0
          if (count === 0) return null
          return (
            <FilterChip
              key={category}
              label={`${getDocumentCategoryMeta(category).label} (${count})`}
              active={categoryFilter === category}
              onClick={() => setCategoryFilter(category)}
            />
          )
        })}
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <FileImage className="mx-auto h-9 w-9 text-gray-300" />
          <p className="mt-2 text-sm font-medium text-gray-700">
            {data.documents.length === 0
              ? "Nenhum documento registrado"
              : "Nenhum documento nesta categoria"}
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-gray-500">
            Envie imagens (JPG, PNG, WEBP) ou PDFs de até 20 MB.
          </p>
          <Button size="sm" className="mt-4" onClick={() => setShowUpload(true)}>
            <Plus className="h-4 w-4" />
            Enviar primeiro arquivo
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((document) => (
            <DocumentCard
              key={document.id}
              document={document}
              onOpen={() => setPreview(document)}
              onArchive={() => handleArchive(document)}
            />
          ))}
        </div>
      )}

      {showUpload && (
        <DocumentUploadModal
          attendanceId={attendanceId}
          onClose={() => setShowUpload(false)}
          onSaved={async (message) => {
            setShowUpload(false)
            setNotice(message)
            await reload()
            onChanged?.()
          }}
        />
      )}

      {preview && (
        <DocumentPreviewModal
          document={preview}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------

function MiniStat({
  label,
  value,
  icon,
}: {
  label: string
  value: number
  icon: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-50">
          {icon}
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
            {label}
          </p>
          <p className="text-lg font-bold text-gray-900">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-blue-600 bg-blue-600 text-white"
          : "border-gray-200 text-gray-600 hover:bg-gray-100"
      )}
    >
      {label}
    </button>
  )
}

function DocumentCard({
  document,
  onOpen,
  onArchive,
}: {
  document: DocumentView
  onOpen: () => void
  onArchive: () => void
}) {
  const meta = getDocumentCategoryMeta(document.category)
  const isImage = isImageDocument(document.mimeType)

  return (
    <div className="group overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Miniatura */}
      <button
        type="button"
        onClick={onOpen}
        className="flex h-36 w-full items-center justify-center overflow-hidden bg-gray-50"
        aria-label={`Abrir ${document.title}`}
      >
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={document.contentUrl}
            alt={document.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-gray-400">
            <FileText className="h-10 w-10" />
            <span className="text-[11px] font-medium">PDF</span>
          </div>
        )}
      </button>

      <div className="space-y-1.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-medium text-gray-900">
            {document.title}
          </p>
          <button
            type="button"
            onClick={onArchive}
            title="Arquivar documento"
            className="shrink-0 rounded-md p-1 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-medium",
              meta.className
            )}
          >
            {meta.label}
          </span>
          {document.toothNumber && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
              Dente {document.toothNumber}
            </span>
          )}
        </div>

        {document.description && (
          <p className="line-clamp-2 text-[11px] text-gray-500">
            {document.description}
          </p>
        )}

        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-gray-400">
          <span>{formatFileSize(document.sizeBytes)}</span>
          <span>
            {new Date(document.createdAt).toLocaleDateString("pt-BR")}
          </span>
          {document.uploadedByName && <span>{document.uploadedByName}</span>}
        </div>
      </div>
    </div>
  )
}

function DocumentPreviewModal({
  document,
  onClose,
}: {
  document: DocumentView
  onClose: () => void
}) {
  const isImage = isImageDocument(document.mimeType)
  const isPdf = isPdfDocument(document.mimeType)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={document.title}
    >
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <div className="min-w-0">
            <h4 className="truncate text-base font-semibold text-gray-900">
              {document.title}
            </h4>
            <p className="text-xs text-gray-500">
              {document.originalName} · {formatFileSize(document.sizeBytes)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-gray-100 p-4">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={document.contentUrl}
              alt={document.title}
              className="mx-auto max-h-[70vh] rounded-lg object-contain shadow"
            />
          ) : isPdf ? (
            <iframe
              src={document.contentUrl}
              title={document.title}
              className="h-[70vh] w-full rounded-lg bg-white"
            />
          ) : (
            <p className="py-10 text-center text-sm text-gray-500">
              Visualização não disponível para este tipo de arquivo.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3.5">
          <a
            href={document.contentUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center rounded-md border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Abrir em nova aba
          </a>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

function DocumentUploadModal({
  attendanceId,
  onClose,
  onSaved,
}: {
  attendanceId: string
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [category, setCategory] = useState<string>("radiograph")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [toothNumber, setToothNumber] = useState<string | null>(null)
  const [dentition, setDentition] = useState<"permanent" | "deciduous">(
    "permanent"
  )
  const [uploadedByName, setUploadedByName] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState("")

  function handleFileChange(selected: File | null) {
    setError("")
    if (!selected) {
      setFile(null)
      return
    }
    setFile(selected)
    // Pré-preenche o título com o nome do arquivo (sem extensão).
    if (!title.trim()) {
      setTitle(selected.name.replace(/\.[^.]+$/, "").slice(0, 200))
    }
  }

  async function handleUpload() {
    if (!file) {
      setError("Selecione um arquivo para enviar.")
      return
    }
    if (title.trim().length < 2) {
      setError("Informe um título para o documento.")
      return
    }

    setIsSaving(true)
    setError("")
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("category", category)
      formData.append("title", title.trim())
      if (description.trim()) formData.append("description", description.trim())
      if (toothNumber) {
        formData.append("toothNumber", toothNumber)
        formData.append("dentition", dentition)
      }
      if (uploadedByName.trim()) {
        formData.append("uploadedByName", uploadedByName.trim())
      }

      const res = await fetch(`/api/attendance/${attendanceId}/documents`, {
        method: "POST",
        body: formData,
      })

      if (res.ok) {
        onSaved(`"${title.trim()}" enviado para o prontuário.`)
        return
      }

      const err = await res.json().catch(() => ({}))
      setError(err.error || "Não foi possível enviar o arquivo.")
    } catch {
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Enviar documento"
    >
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <h4 className="text-base font-semibold text-gray-900">
            Enviar documento / imagem
          </h4>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Arquivo */}
          <div>
            <Label>Arquivo *</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf,.pdf"
              className="hidden"
              onChange={(event) =>
                handleFileChange(event.target.files?.[0] ?? null)
              }
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center gap-3 rounded-lg border border-dashed border-gray-300 px-4 py-4 text-left hover:border-blue-400 hover:bg-blue-50"
            >
              <Upload className="h-6 w-6 shrink-0 text-gray-400" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-700">
                  {file ? file.name : "Selecionar arquivo"}
                </span>
                <span className="block text-[11px] text-gray-400">
                  {file
                    ? formatFileSize(file.size)
                    : "Imagens (JPG, PNG, WEBP) ou PDF · até 20 MB"}
                </span>
              </span>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="doc-category">Categoria *</Label>
              <select
                id="doc-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {DOCUMENT_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {getDocumentCategoryMeta(value).label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="doc-title">Título *</Label>
              <Input
                id="doc-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="doc-description">Descrição</Label>
            <textarea
              id="doc-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              maxLength={1000}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Dente (opcional) — mesma numeração do odontograma */}
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3.5">
            <p className="mb-2 text-xs font-medium text-gray-500">
              Dente relacionado (opcional)
            </p>
            <ToothSurfacePicker
              dentition={dentition}
              toothNumber={toothNumber}
              surfaces={[]}
              onDentitionChange={setDentition}
              onToothChange={setToothNumber}
              onSurfacesChange={() => {}}
            />
          </div>

          <div>
            <Label htmlFor="doc-author">Enviado por</Label>
            <Input
              id="doc-author"
              value={uploadedByName}
              onChange={(event) => setUploadedByName(event.target.value)}
              placeholder="Nome do profissional"
              maxLength={120}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3.5">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancelar
          </Button>
          <Button onClick={handleUpload} disabled={isSaving || !file}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Enviar
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

// Label local (evita import circular com o componente compartilhado).
function Label({
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className="mb-1.5 block text-xs font-medium text-gray-600"
      {...props}
    >
      {children}
    </label>
  )
}
