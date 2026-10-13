# Chave do YouTube unificada

Metadados de vídeos, importação de playlists, identificação pela URL e descoberta de lives usam agora YOUTUBE_API_KEY no servidor. Não existe mais dependência da variável pública antiga.

Na Vercel, mantenha YOUTUBE_API_KEY preenchida, habilite a YouTube Data API v3 para essa chave e publique esta versão. As restrições da chave devem permitir chamadas do servidor; uma chave restrita por HTTP referrer do navegador pode ser recusada. Preserve YOUTUBE_LIVE_CHANNEL_IDS e YOUTUBE_LIVE_HANDLES para a descoberta automática.

O painel chama a nova função autenticada /api/youtube-data, mantendo lotes de 50 vídeos, paginação e cache de metadados. A chave não é incluída no código do navegador. Essa função limita os recursos e parâmetros aceitos. A reprodução por URL não precisa da chave.

Para desenvolvimento com as funções, use vercel dev. npm run dev sozinho não executa as rotas da Vercel.

Validação: 63 testes de regressão, 14 verificações de renderização/gravação simulada e build passaram. Os testes de consultas ao YouTube usam respostas simuladas; nenhuma chave real ou configuração da Vercel foi alterada nesta entrega.
