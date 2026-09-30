"use client"

// ===========================================================================
// UI FINANCEIRA — apresentação compartilhada (Financeiro 1).
// ===========================================================================
// Apenas APRESENTAÇÃO. Nenhum cálculo financeiro é feito aqui: os valores
// chegam prontos do servidor (fonte única: `financial-domain.ts`).
//
// O que a UI NUNCA faz:
//  - inventar valor para preencher gráfico (card vazio mostra R$ 0,00);
//  - misturar recebido com previsto (rótulos distintos);
//  - afirmar que há autenticação/permissão.

import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/schemas"
import { Card, CardContent } from "@/components/ui/card"
import type { DashboardSeriesPoint } from "@/lib/financial-dashboard-service"
import { TRANSACTION_STATUS_COLORS, TRANSACTION_STATUS_LABELS } from "@/lib/financial-domain"

// ---------------------------------------------------------------------------
// Card de métrica
// ---------------------------------------------------------------------------

export interface MetricCardProps {
  label: string
  value: number
  /** Linha secundária (ex.: previsão). Nunca substitui o valor principal. */
  hint?: string
  /** Destaque visual. "negative" não implica erro — só sinaliza saída. */
  tone?: "default" | "positive" | "negative" | "warning" | "neutral"
  icon?: React.ReactNode
}

const TONES: Record<string, { value: string; ring: string }> = {
  default: { value: "text-gray-900", ring: "bg-blue-50 text-blue-600" },
  positive: { value: "text-green-700", ring: "bg-green-50 text-green-600" },
  negative: { value: "text-red-700", ring: "bg-red-50 text-red-600" },
  warning: { value: "text-amber-700", ring: "bg-amber-50 text-amber-600" },
  neutral: { value: "text-gray-700", ring: "bg-gray-100 text-gray-500" },
}

export function MetricCard({ label, value, hint, tone = "default", icon }: MetricCardProps) {
  const t = TONES[tone] ?? TONES.default
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {label}
          </p>
          <p className={cn("mt-1.5 truncate text-2xl font-bold", t.value)}>
            {formatCurrency(value)}
          </p>
          {hint ? (
            <p className="mt-1 text-xs text-gray-500">{hint}</p>
          ) : null}
        </div>
        {icon ? (
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
              t.ring
            )}
          >
            {icon}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Estado vazio
// ---------------------------------------------------------------------------

export function EmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 px-6 py-10 text-center">
      <p className="text-sm font-medium text-gray-700">{title}</p>
      <p className="mt-1 max-w-md text-xs text-gray-500">{description}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Gráfico de fluxo (barras simples — entradas x saídas)
// ---------------------------------------------------------------------------
// Sem dependência externa: o gráfico é uma projeção fiel dos pontos recebidos.
// Se todos os pontos forem zero, a escala permanece 1 e as barras ficam vazias
// — nunca desenhamos altura artificial.

export function FlowChart({ points }: { points: DashboardSeriesPoint[] }) {
  if (points.length === 0) {
    return (
      <EmptyState
        title="Sem movimentações no período"
        description="Assim que houver recebimentos ou despesas, o fluxo aparece aqui."
      />
    )
  }

  const max = Math.max(
    1,
    ...points.map((p) => Math.max(p.income, p.expense))
  )
  const hasAnyValue = points.some((p) => p.income > 0 || p.expense > 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-500" />
          Entradas
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-400" />
          Saídas
        </span>
      </div>

      <div className="flex h-48 items-end gap-[3px] overflow-hidden">
        {points.map((p) => {
          const incomeH = (p.income / max) * 100
          const expenseH = (p.expense / max) * 100
          return (
            <div
              key={p.key}
              className="group relative flex h-full min-w-0 flex-1 items-end justify-center gap-[1px]"
              title={`${p.label} — entradas ${formatCurrency(p.income)} · saídas ${formatCurrency(p.expense)}`}
            >
              <div
                className="w-1/2 rounded-t bg-green-500 transition-all group-hover:bg-green-600"
                style={{ height: `${incomeH}%` }}
              />
              <div
                className="w-1/2 rounded-t bg-red-400 transition-all group-hover:bg-red-500"
                style={{ height: `${expenseH}%` }}
              />
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between text-[10px] text-gray-400">
        <span>{points[0]?.label}</span>
        {points.length > 2 ? (
          <span>{points[Math.floor(points.length / 2)]?.label}</span>
        ) : null}
        <span>{points[points.length - 1]?.label}</span>
      </div>

      {!hasAnyValue ? (
        <p className="text-xs text-gray-500">
          Nenhuma movimentação efetivada ou prevista no período — os totais são
          R$ 0,00.
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Barra de participação (categorias / formas de pagamento)
// ---------------------------------------------------------------------------

export function ShareBar({
  label,
  amount,
  sharePercent,
  color = "bg-blue-500",
  meta,
}: {
  label: string
  amount: number
  sharePercent: number
  color?: string
  meta?: string
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate font-medium text-gray-700">{label}</span>
        <span className="shrink-0 tabular-nums text-gray-900">
          {formatCurrency(amount)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
        <div
          className={cn("h-full rounded-full", color)}
          style={{ width: `${Math.max(0, Math.min(100, sharePercent))}%` }}
        />
      </div>
      <div className="flex justify-between text-[11px] text-gray-500">
        <span>{meta ?? ""}</span>
        <span className="tabular-nums">{sharePercent.toFixed(1)}%</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Badge de status da movimentação
// ---------------------------------------------------------------------------

const STATUS_VARIANT: Record<string, string> = {
  settled: "bg-green-100 text-green-800",
  pending: "bg-amber-100 text-amber-800",
  cancelled: "bg-gray-100 text-gray-600",
  reversed: "bg-red-100 text-red-800",
}

export function TransactionStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        STATUS_VARIANT[status] ?? TRANSACTION_STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700"
      )}
    >
      {TRANSACTION_STATUS_LABELS[status] ?? status}
    </span>
  )
}
