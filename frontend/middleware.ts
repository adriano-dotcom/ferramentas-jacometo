import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const auth = req.cookies.get('hub_auth')
  const isLogin = req.nextUrl.pathname.startsWith('/login')
  const isApi   = req.nextUrl.pathname.startsWith('/api/auth')

  if (isApi) return NextResponse.next()

  if (!auth && !isLogin) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  if (auth && isLogin) {
    return NextResponse.redirect(new URL('/ferramentas', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next|favicon.ico).*)'],
}
