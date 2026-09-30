import type { NextConfig } from "next";

// ===========================================================================
// CONFIGURAÇÃO DO NEXT.JS — OdontoCare (produção)
// ===========================================================================
//
// Em produção, o Next roda atrás do proxy reverso do EasyPanel (HTTPS ->
// http://app:3000). As configurações abaixo preparam o app para esse cenário
// sem alterar regras de negócio nem a identidade visual.
// ===========================================================================

const nextConfig: NextConfig = {
  // `standalone` gera um servidor mínimo auto-contido, ideal para containers.
  output: "standalone",

  // Em produção, não expõe a versão do framework via header X-Powered-By.
  poweredByHeader: false,

  // Compressão de resposta.
  compress: true,

  // Cabeçalhos de segurança aplicados a todas as respostas.
  // NÃO incluem HSTS agressivo: o HTTPS é terminado pelo EasyPanel, que já
  // aplica HSTS. Aqui priorizamos proteção contra sniffing e framing.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
