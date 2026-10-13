# Atualização v7 — TREND Wall editorial

- Criado o modelo gráfico PNG de 1920×1080 para lower third, ticker inferior e painel social. A arte de origem também está em SVG para edição visual; título e mensagens são HTML sobrepostos e podem ser substituídos pelo painel.
- A redação foi simplificada em três tipos de entrada: Manchete, Tweet e Trending topic.
- Manchete: título até 78 caracteres/12 palavras, subtítulo até 130, categoria, fonte e imagem opcional por URL HTTP(S), com prévia.
- Tweet: mensagem manual até 160 caracteres, perfil/autor e link opcional.
- Trending topic: texto até 54 caracteres, assunto/fonte e link opcional.
- Cada tipo pode ser aprovado, marcado urgente e definido para permanecer no ar por 10, 15, 20 ou 30 minutos.
- A TV apresenta manchete + linha fina no lower third, ticker inferior e coluna rolante de posts/tópicos à direita. A velocidade social é configurável. Conteúdo social legado é convertido para o tipo Tweet.
- A prévia do painel usa enquadramento 16:9. O PNG é pré-carregado pelo service worker; seu hash participa da versão do cache para que a arte atualize junto com o app.
- Não foi adicionada busca automática no X. Tweets e tópicos são selecionados manualmente; API oficial pode ser avaliada separadamente.

## Validação

- `npm test`: aprovado; três arquivos de teste, incluindo cinco testes para tipos, limites e compatibilidade social.
- `npm run build`: build Vite aprovado.
- PNG validado como RGBA 1920×1080.
