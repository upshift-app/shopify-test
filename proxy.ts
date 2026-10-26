import { NextResponse, type NextRequest } from 'next/server';

// Basic auth for the seller dashboard. Username is ignored, only ADMIN_PASSWORD counts.
export function proxy(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  const header = request.headers.get('authorization') ?? '';
  const [scheme, encoded] = header.split(' ');
  if (password && scheme === 'Basic' && encoded) {
    const decoded = atob(encoded);
    if (decoded.slice(decoded.indexOf(':') + 1) === password) return NextResponse.next();
  }
  return new NextResponse('Prisijunkite', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Intere"' } });
}

export const config = { matcher: ['/admin/:path*', '/api/admin/:path*'] };
