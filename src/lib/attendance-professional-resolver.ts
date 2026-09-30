// ===========================================================================
// RESOLUÇÃO DO PROFISSIONAL RESPONSÁVEL EM REGISTROS DE ATENDIMENTO.
//
// O atendimento guarda um SNAPSHOT CONGELADO da identidade de quem o encerrou
// (`finished_by_name` / `finished_by_council`) e, quando disponível, o vínculo
// com o cadastro (`finished_by_id`). Este módulo traduz esse par em uma
// identidade VIVA (id + nome atual) para exibição no histórico.
//
// Duas responsabilidades, deliberadamente separadas:
//   - `buildProfessionalIndex`: UMA consulta que carrega os profissionais
//     necessários para resolver uma página inteira do histórico (sem N+1);
//   - `resolveProfessional`: função PURA que aplica o índice a uma linha.
//
// A resolução é tolerante por design:
//   1. vínculo por id (`finishedById`) tem precedência;
//   2. sem vínculo, casa o NOME CONGELADO com um profissional cadastrado —
//      cobre atendimentos finalizados antes de existir o vínculo por id, sem
//      exigir migração de dados;
//   3. sem correspondência, retorna `null` (o consumidor exibe a identidade
//      textual congelada, jamais um dado inventado).
// ===========================================================================

import { prisma } from "@/lib/prisma"
import { normalizeName } from "@/lib/professionals-domain"

// Chave de COMPARAÇÃO de nomes: caixa baixa, sem acentos e com espaços
// colapsados. É derivada de `normalizeName` (que já trata os espaços) e por
// isso nunca guarda o valor exibido — apenas serve para casar o nome
// congelado no atendimento com o nome do cadastro.
function nameKey(value: string): string {
  return normalizeName(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

// Segmento mínimo que o histórico precisa exibir. O conselho fica de fora de
// propósito: ele já está congelado no atendimento e a fonte da verdade ali é
// sempre o snapshot.
export type AttendanceProfessionalRef = {
  id: string
  name: string
}

export type AttendanceProfessionalIndex = {
  byId: Map<string, AttendanceProfessionalRef>
  byName: Map<string, AttendanceProfessionalRef>
}

// Formato mínimo das linhas do atendimento que participam da resolução.
export type AttendanceProfessionalSource = {
  finishedById: string | null
  finishedByName: string | null
}

/**
 * Carrega, em UMA consulta, os profissionais necessários para resolver todas
 * as linhas informadas: tanto os referenciados por id quanto os que casam
 * pelos nomes congelados.
 */
export async function buildProfessionalIndex(
  rows: AttendanceProfessionalSource[]
): Promise<AttendanceProfessionalIndex> {
  const ids = [
    ...new Set(
      rows.map((r) => r.finishedById).filter((id): id is string => !!id)
    ),
  ]
  const names = [
    ...new Set(
      rows
        .map((r) => r.finishedByName)
        .filter((name): name is string => !!name && !!name.trim())
    ),
  ]

  const byId = new Map<string, AttendanceProfessionalRef>()
  const byName = new Map<string, AttendanceProfessionalRef>()

  if (ids.length === 0 && names.length === 0) {
    return { byId, byName }
  }

  // O casamento por nome é feito em MEMÓRIA (normalizando caixa/acentos), que
  // não é expressável em SQL sem depender de extensão/collation do SQLite.
  // Para não varrer a tabela inteira, restringimos o conjunto candidato pela
  // PRIMEIRA PALAVRA de cada nome congelado — o casamento por acento/caixa
  // nunca altera a primeira palavra além desses dois fatores, e o filtro é um
  // `startsWith` indexável que apenas reduz o universo; a decisão final
  // continua sendo a comparação normalizada, abaixo.
  const firstWords = [
    ...new Set(
      names
        .map((name) => nameKey(name).split(" ")[0])
        .filter((word) => word.length > 0)
    ),
  ]

  const professionals = await prisma.professional.findMany({
    where: {
      OR: [
        ids.length > 0 ? { id: { in: ids } } : undefined,
        firstWords.length > 0
          ? { OR: firstWords.map((word) => ({ fullName: { startsWith: word } })) }
          : undefined,
      ].filter((clause): clause is NonNullable<typeof clause> => !!clause),
    },
    select: { id: true, fullName: true },
    orderBy: { createdAt: "asc" },
  })

  for (const pro of professionals) {
    const ref = { id: pro.id, name: pro.fullName }
    byId.set(pro.id, ref)
    const key = nameKey(pro.fullName)
    // Em caso de homônimos, mantém o cadastro mais antigo de forma estável.
    if (!byName.has(key)) byName.set(key, ref)
  }

  return { byId, byName }
}

/**
 * Resolve a identidade do profissional de UMA linha, aplicando o índice.
 *
 * A função é PURA: toda a I/O aconteceu em `buildProfessionalIndex`. Isso
 * permite testar a regra de precedência (id → nome → nulo) sem banco.
 */
export function resolveProfessional(
  index: AttendanceProfessionalIndex,
  row: AttendanceProfessionalSource
): AttendanceProfessionalRef | null {
  // 1) Vínculo explícito por id — a correspondência mais forte.
  if (row.finishedById) {
    const linked = index.byId.get(row.finishedById)
    if (linked) return linked
  }
  // 2) Fallback legado: nome congelado casando com o cadastro.
  if (row.finishedByName) {
    const linked = index.byName.get(nameKey(row.finishedByName))
    if (linked) return linked
  }
  // 3) Sem correspondência: o histórico permanece com a identidade textual.
  return null
}
