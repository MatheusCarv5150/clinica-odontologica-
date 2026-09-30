// ===========================================================================
// EXPORTAÇÃO CSV — módulo Financeiro (Financeiro 6).
// ===========================================================================
//
// Utilitário de exportação dos relatórios em CSV. Implementado SEM dependência
// externa (o projeto não possui biblioteca de exportação), de forma organizada
// e reutilizável.
//
// REGRAS
//   * o CSV respeita EXATAMENTE os dados recebidos (filtros/período são
//     aplicados no servidor antes de exportar — esta camada não filtra);
//   * separador ponto e vírgula (;) e BOM UTF-8, para abrir corretamente no
//     Excel em português;
//   * números são formatados com vírgula decimal (padrão pt-BR);
//   * datas/hora são formatadas em "DD/MM/YYYY HH:MM";
//   * proteção contra fórmula (CSV injection): células iniciadas por
//     = + - @ são prefixadas com apóstrofo.
//
// O nome do arquivo segue o padrão `relatorio-<tipo>-YYYY-MM-DD.csv`, com a
// data do dia em que a exportação foi gerada.
//
// Este arquivo é PURO (sem acesso a banco): recebe linhas já prontas.

export interface CsvColumn<T> {
  header: string
  /** Extrai o valor já formatado (string/number) da linha. */
  value: (row: T) => string | number | null | undefined
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/

/** Escapa uma célula CSV (aspas, separador, quebras e fórmulas). */
function escapeCell(input: string | number | null | undefined): string {
  if (input == null) return ""
  let text = typeof input === "number" ? formatNumber(input) : String(input)
  // Proteção contra CSV injection.
  if (FORMULA_PREFIX.test(text)) text = `'${text}`
  // Aspas duplas dentro da célula são duplicadas e a célula é envolvida.
  if (/[";\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/** Formata número com vírgula decimal (sem separador de milhar). */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0"
  return value.toFixed(2).replace(".", ",")
}

/** Formata uma data ISO em "DD/MM/YYYY" (aceita data pura ou ISO). */
export function formatCsvDate(value: string | null | undefined): string {
  if (!value) return ""
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (m && value.length <= 10) return `${m[3]}/${m[2]}/${m[1]}`
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const day = String(d.getDate()).padStart(2, "0")
  const month = String(d.getMonth() + 1).padStart(2, "0")
  return `${day}/${month}/${d.getFullYear()}`
}

/** Formata data/hora em "DD/MM/YYYY HH:MM". */
export function formatCsvDateTime(value: string | null | undefined): string {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const day = String(d.getDate()).padStart(2, "0")
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return `${day}/${month}/${d.getFullYear()} ${hh}:${mm}`
}

/** Constrói o conteúdo CSV (com BOM UTF-8 e CRLF). */
export function buildCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCell(c.header)).join(";")
  const body = rows.map((row) => columns.map((c) => escapeCell(c.value(row))).join(";"))
  // BOM (\uFEFF) para o Excel reconhecer UTF-8.
  return "\uFEFF" + [header, ...body].join("\r\n") + "\r\n"
}

/** Data de hoje "YYYY-MM-DD" (fuso local). */
export function todayStamp(reference: Date = new Date()): string {
  const y = reference.getFullYear()
  const m = String(reference.getMonth() + 1).padStart(2, "0")
  const d = String(reference.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/** Nome de arquivo padronizado: `relatorio-<tipo>-YYYY-MM-DD.csv`. */
export function reportFileName(tipo: string, reference: Date = new Date()): string {
  return `relatorio-${tipo}-${todayStamp(reference)}.csv`
}

/**
 * Dispara o download do CSV no navegador.
 * Recebe o conteúdo e o nome do arquivo (não acessa o servidor).
 */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
