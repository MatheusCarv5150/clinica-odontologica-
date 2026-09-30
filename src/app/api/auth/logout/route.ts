import { NextResponse } from "next/server"
import { getLogoutCookieOptions } from "@/lib/auth-service"

export const dynamic = "force-dynamic"

// POST /api/auth/logout
//
// Remove o cookie de sessão, invalidando o acesso.
export async function POST() {
  const cookieOptions = getLogoutCookieOptions()

  const response = NextResponse.json(
    { success: true },
    { status: 200 }
  )

  response.cookies.set(cookieOptions)

  return response
}