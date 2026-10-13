# Atualização v10 — lives por canal e controle 2× separado

- O editor de programa agora tem um tipo **Live do YouTube** separado de **Vídeos / Playlist**. Informe o ID do canal, a URL `/channel/UC...` ou `@handle`; não precisa trocar o link da live a cada transmissão.
- Durante o horário desse programa, a TV consulta uma função da Vercel para encontrar a transmissão pública ativa e troca o vídeo automaticamente. Se não houver live ativa, mostra “Aguardando a próxima live” e tenta novamente.
- A resposta é compartilhada pelo cache da CDN por 15 minutos e a interface verifica a cada 5 minutos. A nova live pode levar até cerca de 15 minutos para aparecer.
- O botão **Reduzir atraso · 2×** aparece somente durante programas marcados como Live. Quando disponível, acelera até perto do live edge e volta a 1×. Playlists normais mantêm seu player, velocidade e sincronização anteriores.
- A busca automática exige `YOUTUBE_API_KEY` como variável secreta da Vercel e `YOUTUBE_LIVE_CHANNEL_IDS` como lista de IDs UC permitidos, separados por vírgula. O YouTube aplica cota diária; a busca foi limitada e armazenada em cache.
- Para validar localmente a função, use `vercel dev`; o servidor Vite (`npm run dev`) não serve arquivos da pasta `api/`.

## Validação

- `npm test`: aprovado; inclui testes para normalização do ID/handle, preservação de `isLive` na grade e resposta/cache da função.
- `npm run build`: aprovado. O aviso do bundle inicial acima de 500 kB continua presente.
- A consulta real exige a chave e a allowlist na Vercel; a reprodução não foi testada com o canal do usuário.
