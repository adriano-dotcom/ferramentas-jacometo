/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16 limita o corpo de requisições proxyadas (rewrites) a 10MB por padrão,
  // truncando uploads grandes em silêncio. Em /api/rpa/quiver-faturas/cadastrar isso
  // travava o envio em ~20 PDFs (~10MB). Elevamos o teto; o limite real passa a ser
  // o do Cloudflare (~100MB/requisição). Acima disso é preciso chunking no upload.
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
  async rewrites() {
    return [
      {
        source: '/api/rpa/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
