// ===========================================================================
// PROXY (antigo middleware) DE AUTENTICAÇÃO — OdontoCare
// ===========================================================================
//
// Protege todas as rotas internas do sistema. Qualquer acesso a
// /agenda, /pacientes, /procedimentos, /atendimento, /financeiro,
// /configuracoes sem sessão válida é redirecionado para /login.
//
// As rotas públicas são:
//   - /login           (página de login)
//   - /api/auth/login  (endpoint de login)
//   - /api/auth/logout (endpoint de logout)
//
// PROTEGE SOMENTE O FRONTEND (páginas). Os endpoints de API validam
// autenticação individualmente (camada de defesa em profundidade).
//
// NOTA: no Next.js 16 a convenção `middleware.ts` foi renomeada para
// `proxy.ts` (função `proxy`). Mantemos o comportamento idêntico.
// ===========================================================================

import { NextRequest, NextResponse } from "next/server"

const SESSION_COOKIE_NAME = "odontocare_session"

function isPublicRoute(pathname: string): boolean {
  if (
    pathname === "/login" ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/auth/") ||
    pathname.includes(".")
  ) {
    return true
  }
  return false
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value

  if (isPublicRoute(pathname)) {
    if (pathname === "/login" && sessionCookie) {
      return NextResponse.redirect(new URL("/agenda", request.url))
    }
    return NextResponse.next()
  }

  if (!sessionCookie) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Não autenticado.", code: "UNAUTHENTICATED" },
        { status: 401 }
      )
    }

    const url = new URL("/login", request.url)
    url.searchParams.set("from", pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|favicon.svg|logo-icon.svg).*)",
  ],
}