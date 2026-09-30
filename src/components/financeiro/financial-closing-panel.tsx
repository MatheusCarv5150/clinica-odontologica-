"use client"

// ===========================================================================
// PAINEL DE FECHAMENTO FINANCEIRO — módulo Financeiro (Financeiro 6).
// ===========================================================================
//
// Tela de FECHAMENTO: valida o período, fecha, consulta histórico, vê o
// snapshot, detecta alterações retroativas e reabre (com motivo).
//
// APRESENTAÇÃO apenas: nenhum número é calculado aqui. O cliente informa o
// PERÍODO e (quando reabre) o MOTIVO. Os totais vêm do servidor.
//
// REGRAS REFLETIDAS NA UI:
//   * fechar NÃO apaga dados — congela um snapshot e registra auditoria;
//   * a validação mostra bloqueios ANTES de permitir fechar;
//   * reabrir exige motivo;
//   * divergências entre snapshot e valores atuais são exibidas (alteração
//     retroativa detectada), sem esconder nada.

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/schemas"
import { MetricCard, EmptyState } from "@/components/financeiro/financial-ui"
import type {
  ClosingDetail,
  ClosingListItem,
  ValidateClosingResult,
} from "@/lib/financial-closing-service"

function monthRange(year: number, month: number): { from: string; to: string } {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`
  return { from: fmt(first), to: fmt(last) }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR")
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function FinancialClosingPanel() {
  const now = new Date()
  const [range, setRange] = useState(() => monthRange(now.getFullYear(), now.getMonth()))
  const [validation, setValidation] = useState<ValidateClosingResult | null>(null)
  const [validating, setValidating] = useState(false)
  const [notes, setNotes] = useState("")
  const [actorName, setActorName] = useState("")
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [history, setHistory] = useState<ClosingListItem[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [selected, setSelected] = useState<ClosingDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [reopenReason, setReopenReason] = useState("")
  const [reopening, setReopening] = useState(false)

  // --- Histórico -----------------------------------------------------------

  const loadHistory = useCallback(async () => {
    // `await` inicial: a regra `react-hooks/set-state-in-effect` proíbe
    // setState síncrono no corpo de um efeito (cascata de renders). Todo o
    // trabalho do loader passa a ser assíncrono.
    await Promise.resolve()
    setLoadingHistory(true)
    try {
      const res = await fetch("/api/financial/closings?pageSize=50", { cache: "no-store" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Falha ao carregar histórico.")
      setHistory(json.closings as ClosingListItem[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar histórico.")
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  useEffect(() => {
    // Adia para fora do corpo síncrono do efeito (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => void loadHistory(), 0)
    return () => clearTimeout(timer)
  }, [loadHistory])

  // --- Validação -----------------------------------------------------------

  const validate = useCallback(async () => {
    // Ver comentário em `loadHistory`: o efeito que dispara a validação não
    // pode provocar setState síncrono.
    await Promise.resolve()
    setValidating(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to })
      const res = await fetch(`/api/financial/closings?${params.toString()}`, {
        cache: "no-store",
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Falha ao validar período.")
      setValidation(json as ValidateClosingResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao validar período.")
    } finally {
      setValidating(false)
    }
  }, [range])

  useEffect(() => {
    // Adia para fora do corpo síncrono do efeito (react-hooks/set-state-in-effect).
    if (!range.from || !range.to || range.from > range.to) return
    const timer = setTimeout(() => void validate(), 0)
    return () => clearTimeout(timer)
  }, [range, validate])

  // --- Fechar --------------------------------------------------------------

  const handleClose = async () => {
    if (!validation?.canClose) return
    setClosing(true)
    setError(null)
    try {
      const res = await fetch("/api/financial/closings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: range.from,
          to: range.to,
          notes: notes.trim() || null,
          actorName: actorName.trim(),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Falha ao fechar período.")
      setNotes("")
      await loadHistory()
      setValidation(null)
      await validate()
      setSelected(json.closing as ClosingDetail)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao fechar período.")
    } finally {
      setClosing(false)
    }
  }

  // --- Detalhe -------------------------------------------------------------

  const openDetail = async (id: string) => {
    setLoadingDetail(true)
    setError(null)
    try {
      const res = await fetch(`/api/financial/closings?id=${id}`, { cache: "no-store" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Falha ao abrir fechamento.")
      setSelected(json.closing as ClosingDetail)
      setReopenReason("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao abrir fechamento.")
    } finally {
      setLoadingDetail(false)
    }
  }

  // --- Reabrir -------------------------------------------------------------

  const handleReopen = async () => {
    if (!selected || reopenReason.trim().length < 3) return
    setReopening(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/financial/closings?id=${selected.id}&action=reopen`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reopenReason.trim(), actorName: actorName.trim() }),
        }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Falha ao reabrir período.")
      setReopenReason("")
      await loadHistory()
      setSelected(json.closing as ClosingDetail)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao reabrir período.")
    } finally {
      setReopening(false)
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Fechar período */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fechar período</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
                Início
              </span>
              <input
                type="date"
                value={range.from}
                onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
                Fim
              </span>
              <input
                type="date"
                value={range.to}
                onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <Button variant="outline" onClick={validate} disabled={validating}>
              {validating ? "Validando…" : "Validar período"}
            </Button>
          </div>

          {validation && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label="Receitas recebidas" value={validation.preview.income} tone="positive" />
                <MetricCard label="Despesas pagas" value={validation.preview.expense} tone="negative" />
                <MetricCard label="Resultado do período" value={validation.preview.result} />
                <MetricCard label="Saldo do caixa" value={validation.preview.periodBalance} />
              </div>

              <div className="space-y-1 rounded-md border border-gray-200 bg-gray-50 p-3">
                {validation.checks.map((c) => (
                  <div key={c.code} className="flex items-start gap-2 text-sm">
                    <span
                      className={cn(
                        "mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full",
                        c.blocking ? "bg-red-500" : "bg-green-500"
                      )}
                    />
                    <span className={c.blocking ? "text-red-700" : "text-gray-600"}>
                      {c.description}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
                Responsável (atribuição)
              </span>
              <input
                type="text"
                value={actorName}
                onChange={(e) => setActorName(e.target.value)}
                placeholder="Nome de quem está fechando"
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
                Observação (opcional)
              </span>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex.: conferido com o extrato"
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
            </label>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleClose}
              disabled={!validation?.canClose || closing}
            >
              {closing ? "Fechando…" : "Fechar período"}
            </Button>
            <p className="text-xs text-gray-500">
              O fechamento não apaga movimentações: ele congela um snapshot e registra
              auditoria.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Histórico */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico de fechamentos</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingHistory ? (
            <p className="px-4 py-6 text-sm text-gray-500">Carregando…</p>
          ) : history.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500">
              Nenhum período fechado ainda.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-2 font-medium">Período</th>
                    <th className="px-4 py-2 font-medium">Situação</th>
                    <th className="px-4 py-2 font-medium">Resultado</th>
                    <th className="px-4 py-2 font-medium">Fechado em</th>
                    <th className="px-4 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {history.map((c) => (
                    <tr key={c.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-2 text-gray-700">
                        {fmtDate(c.periodStart)} — {fmtDate(c.periodEnd)}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                            c.status === "reopened"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-green-100 text-green-800"
                          )}
                        >
                          {c.statusLabel}
                          {c.hasChanges ? " · alterado" : ""}
                        </span>
                      </td>
                      <td className="px-4 py-2 tabular-nums text-gray-700">
                        {formatCurrency(c.snapshot.result)}
                      </td>
                      <td className="px-4 py-2 text-gray-500">
                        {fmtDateTime(c.closedAt)}
                        {c.closedByName ? ` · ${c.closedByName}` : ""}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openDetail(c.id)}
                          disabled={loadingDetail}
                        >
                          Detalhes
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detalhe */}
      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Fechamento {fmtDate(selected.periodStart)} — {fmtDate(selected.periodEnd)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="Receitas" value={selected.snapshot.income} tone="positive" />
              <MetricCard label="Despesas" value={selected.snapshot.expense} tone="negative" />
              <MetricCard label="Resultado" value={selected.snapshot.result} />
              <MetricCard label="Saldo final" value={selected.snapshot.closingBalance} />
            </div>

            {/* Comparação snapshot x atual */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-800">
                Conferência (snapshot x valores atuais)
              </h3>
              {!selected.comparison.hasChanges ? (
                <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                  Nenhuma alteração retroativa detectada no período.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-amber-200 bg-amber-50">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-amber-800">
                        <th className="px-3 py-2 font-medium">Campo</th>
                        <th className="px-3 py-2 font-medium">No fechamento</th>
                        <th className="px-3 py-2 font-medium">Atual</th>
                        <th className="px-3 py-2 font-medium">Diferença</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.comparison.lines.map((f) => (
                        <tr key={f.field} className="border-t border-amber-200/60">
                          <td className="px-3 py-2 text-amber-900">{f.label}</td>
                          <td className="px-3 py-2 tabular-nums text-amber-900">
                            {formatCurrency(f.snapshotValue)}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-amber-900">
                            {formatCurrency(f.currentValue)}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2 tabular-nums font-medium",
                              f.changed ? "text-red-700" : "text-amber-900"
                            )}
                          >
                            {formatCurrency(f.difference)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Auditoria */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-800">Trilha de auditoria</h3>
              {selected.logs.length === 0 ? (
                <p className="text-sm text-gray-400">Sem registros.</p>
              ) : (
                <ul className="space-y-2">
                  {selected.logs.map((log) => (
                    <li
                      key={log.id}
                      className="rounded-md border border-gray-200 px-3 py-2 text-sm"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-gray-800">{log.eventLabel}</span>
                        <span className="text-xs text-gray-400">
                          {fmtDateTime(log.createdAt)}
                        </span>
                      </div>
                      <p className="text-gray-600">{log.description}</p>
                      {log.reason && (
                        <p className="mt-1 text-xs text-gray-500">Motivo: {log.reason}</p>
                      )}
                      {log.performedByName && (
                        <p className="text-xs text-gray-400">
                          Responsável: {log.performedByName}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {selected.notes && (
              <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
                Observação do fechamento: {selected.notes}
              </p>
            )}

            {/* Reabertura */}
            {selected.status === "closed" && (
              <div className="space-y-3 rounded-md border border-gray-200 p-3">
                <h3 className="text-sm font-semibold text-gray-800">Reabrir período</h3>
                <p className="text-xs text-gray-500">
                  A reabertura é registrada em auditoria e exige um motivo.
                </p>
                <input
                  type="text"
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  placeholder="Motivo da reabertura (obrigatório)"
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                />
                <Button
                  variant="outline"
                  onClick={handleReopen}
                  disabled={reopening || reopenReason.trim().length < 3}
                >
                  {reopening ? "Reabrindo…" : "Reabrir período"}
                </Button>
              </div>
            )}
            {selected.status === "reopened" && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Período reaberto. Motivo: {selected.reopenReason ?? "—"} (
                {fmtDateTime(selected.reopenedAt)})
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!selected && history.length > 0 && (
        <EmptyState
          title="Nenhum fechamento selecionado"
          description="Selecione um item do histórico para ver snapshot, conferência e auditoria."
        />
      )}
    </div>
  )
}
