// Utilitários de data para rotas de API (server-side).
// Trabalham com o fuso local do servidor e evitam o deslocamento de UTC
// que ocorre ao usar new Date("YYYY-MM-DD") + setHours.

// Retorna o intervalo [início, fim] do dia correspondente a "YYYY-MM-DD".
// Lança erro se a data for inválida.
export function getDayRange(dateStr: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  if (!match) {
    throw new Error("Data inválida. Utilize o formato YYYY-MM-DD.")
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  // A agenda salva as datas em UTC à meia-noite ("YYYY-MM-DDT00:00:00.000Z"),
  // portanto buscamos exatamente o intervalo UTC do dia.
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
  if (Number.isNaN(start.getTime())) {
    throw new Error("Data inválida. Utilize o formato YYYY-MM-DD.")
  }
  const end = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
  return { start, end }
}

// Chave "YYYY-MM-DD" a partir de um Date no fuso local
export function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

// Data de hoje no formato "YYYY-MM-DD" (fuso local do servidor)
export function todayKey(): string {
  return toDateKey(new Date())
}

// Calcula a idade em anos a partir da data de nascimento
export function calculateAge(birthDate: Date, reference: Date = new Date()): number | null {
  if (Number.isNaN(birthDate.getTime())) return null
  let age = reference.getFullYear() - birthDate.getFullYear()
  const monthDiff = reference.getMonth() - birthDate.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && reference.getDate() < birthDate.getDate())) {
    age--
  }
  if (age < 0 || age > 130) return null
  return age
}

// Normaliza o horário para "HH:MM" quando válido; caso contrário retorna null.
export function normalizeTime(time: string | null | undefined): string | null {
  if (!time) return null
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}
