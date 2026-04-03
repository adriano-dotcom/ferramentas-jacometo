import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { senha } = await req.json()

  if (senha !== process.env.HUB_PASSWORD) {
    return NextResponse.json({ erro: 'Senha incorreta' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set('hub_auth', process.env.JWT_SECRET || 'secret', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 8, // 8 horas
    path: '/',
  })
  return res
}
