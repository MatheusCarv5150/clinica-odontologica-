"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Carrega dados de uma API a partir de uma chave de dependência.
 *
 * Por que existe: a regra `react-hooks/set-state-in-effect` (preset oficial do
 * Next.js) proíbe `setState` síncrono no corpo de um efeito. Em componentes que
 * fazem fetch, o padrão comum de `useEffect(() => { void load() }, [load])`
 * continua disparando a regra, porque `load()` é chamada de forma síncrona.
 *
 * Aqui a busca acontece inteiramente dentro de uma função assíncrona: todo
 * `setState` ocorre após um `await`, nunca antes do primeiro ponto de suspensão
 * do efeito. Também trata corrida de requisições (respostas fora de ordem) e
 * descarta atualizações após o desmonte.
 *
 * @param fetcher função que resolve os dados. Deve ser estável (useCallback).
 * @param deps dependências que, ao mudarem, disparam uma nova busca.
 * @returns estado da busca + função `reload` para recarregar manualmente.
 */
export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[]
) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(true)

  // Identificador da requisição mais recente: respostas antigas são ignoradas.
  const requestIdRef = useRef(0)
  // Evita atualizar estado após o desmonte do componente.
  const mountedRef = useRef(true)

  // A `fetcher` é mantida em uma ref para que o efeito dependa apenas de `deps`,
  // sem exigir que o chamador a memoize nem disparar buscas extras.
  // A escrita acontece em um efeito: refs não podem ser atualizadas no render.
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  }, [fetcher])

  const run = useCallback(async () => {
    const requestId = ++requestIdRef.current

    // Um efeito não pode chamar setState sincronamente: a espera por uma
    // microtask garante que a primeira atualização já seja assíncrona.
    await Promise.resolve()
    if (!mountedRef.current || requestId !== requestIdRef.current) return

    setIsLoading(true)
    setError("")

    try {
      const result = await fetcherRef.current()
      if (!mountedRef.current || requestId !== requestIdRef.current) return
      setData(result)
    } catch {
      if (!mountedRef.current || requestId !== requestIdRef.current) return
      setError("Erro de conexão. Tente novamente.")
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void run()
    return () => {
      mountedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error, isLoading, reload: run }
}
