# Notícias, tweets e lives — atualização de 13/10/2026 UTC

## Implementado

- Cadastro de Live com URL direta. O ID é usado pelo player imediatamente, sem esperar a descoberta por handle. A miniatura também é extraída dessa URL.
- Identificação automática do canal/título pela URL no formulário, por função autenticada. Depende de `YOUTUBE_API_KEY` no servidor. Um erro nessa identificação não impede salvar/reproduzir uma URL válida.
- Se houver canal identificado/configurado, a TV inicia a descoberta após dois minutos e consulta novamente a cada cinco minutos. O cache atual da descoberta pode retardar a atualização dos resultados; a URL direta continua como alternativa.
- Importação de fontes RSS/Atom/JSON configuradas no servidor para notícias, tweets ou topics. Fontes para tweets precisam fornecer esses posts legitimamente em RSS/JSON; não há scraping nem integração automática com a API do X nesta entrega.
- Opção para importar a cada cinco minutos enquanto a Redação estiver aberta e visível. É uma automação do painel, não um serviço de coleta 24 horas independente dele.
- Itens importados entram para revisão. Salvar rascunho persiste a fila; Publicar na TV coloca os aprovados no ar. Fechar o painel sem salvar descarta importações locais.
- Deduplicação por ID e por conteúdo/link; links twitter.com/x.com equivalentes e parâmetros comuns de tracking são normalizados. Aprovação existente é preservada ao importar novamente.
- Proteção contra clique duplo ao adicionar item; bloqueio síncrono de publicações/importações concorrentes.
- Painel social desenha uma única fila. A rolagem vai e volta no conteúdo excedente; não duplica a fila no mesmo espaço para animar.

## Configurar fontes

Na Vercel, variável `EDITORIAL_SOURCES` deve conter JSON, por exemplo:

```json
[
  {"id":"noticias","name":"Minha fonte de notícias","kind":"news","url":"https://fonte-confiavel.example/rss"},
  {"id":"tweets","name":"Posts autorizados","kind":"tweet","url":"https://fonte-confiavel.example/posts.json"}
]
```

As URLs acima são exemplos, não fontes reais. Cadastre feeds públicos HTTPS confiáveis, sem redirecionamentos. Tipos permitidos: news, tweet, topic, mixed. JSON pode ser uma lista ou `{"items":[...]}`. Itens usam `title`, `source`, `url` e opcionalmente `subtitle`, `category`, `imageUrl`, `kind`. O limite da resposta é 500 KB; até 100 rascunhos no painel. Não coloque credenciais do Firebase nesses feeds.

A função só aceita IDs da lista do servidor, não URLs fornecidas por visitantes. Exige sessão Firebase e conta habilitada no documento `admins`. O token é validado pelo Firebase ao ler o documento protegido; o token não é devolvido nem registrado pela aplicação. A sessão Admin continua limitada a oito horas. O projeto padrão é `tvweb-71058`, configurável em `FIREBASE_PROJECT_ID`.

Na Redação: Carregar fontes configuradas → selecionar → Importar agora ou marcar atualização automática → revisar → salvar/publicar.

Para descoberta de novas lives, mantenha `YOUTUBE_LIVE_CHANNEL_IDS` com os IDs UC permitidos. Para usar handles diretamente, mantenha também `YOUTUBE_LIVE_HANDLES`. A URL direta toca mesmo sem essa configuração de descoberta.

## Validação

- Login seguro realizado no Admin publicado. O painel e os rascunhos carregaram.
- Clique duplo reproduzido na versão publicada: o contador passou de 3 para 5 itens e surgiram dois tweets vazios. Nenhum desses itens foi salvo ou publicado.
- Após o teste, a proteção de credenciais bloqueou novas ações automatizadas; não foi possível confirmar o descarte pela interface. As alterações de teste eram somente locais.
- A versão publicada observada é anterior a esta entrega; funções novas não foram testadas como instaladas na produção.
- 54 testes de regras/regressão, 10 verificações de componentes/gravações simuladas e build de produção aprovados.
- Sintaxe das novas funções de servidor aprovada. APIs externas nos testes são simuladas; não houve teste real de feeds ou do YouTube com chaves do servidor.

## Instalação e pendências

Publicar o código atualizado na Vercel e configurar as fontes reais/variáveis. Em desenvolvimento, `vercel dev` executa as funções; Vite sozinho não as executa. A coleta contínua após fechar o painel exige um agendador/worker persistente e não está incluída nesta automação do painel.

O acesso autenticado foi usado apenas para verificar a interface e reproduzir o erro. A senha não foi recebida em chat, gravada no código ou incluída neste pacote.
