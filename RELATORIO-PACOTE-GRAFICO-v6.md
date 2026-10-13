# TREND TV — avaliação do GC editorial e canal de notícias

Revisão do código atual e teste somente de leitura da versão publicada em `https://trendtv.vercel.app`, em 12/10/2026 (horário de Brasília). Nenhuma alteração foi feita no site publicado nem em dados do Firebase.

## Teste da versão publicada

- A Home carregou e exibiu quatro canais. O guia informa a janela de 24 horas e apresenta horários que atravessam a meia-noite.
- O canal 30, FofocaNews, abriu corretamente em `/tv?canal=30`. Às 16:50, o player mostrava “Voltamos já!” e indicava a próxima atração para 00:00 do dia seguinte. O guia rápido confirmou que não há bloco programado no intervalo restante do dia. Isso parece ser uma lacuna da grade publicada, não falha do player; vale preencher ou revisar as datas/horários desse canal.
- O guia rápido abriu, posicionou a linha do tempo na hora atual e permitiu ver as atrações seguintes e do dia seguinte.
- `/admin` apresentou a tela de autenticação. Não foi possível validar salvamento/publicação no Firebase sem uma sessão autorizada; o painel e as regras foram revisados estaticamente no código.

## O que o projeto já tem

`NewsEditor.jsx`, `NewsOverlay.jsx` e `news.js` já implementam a base do pacote editorial:

- rascunhos por canal e publicação em tempo real pelo Firestore;
- manchete, fonte/autoria, URL, categoria notícia ou publicação manual, aprovação e sinalização de urgência;
- ticker inferior e GC de manchete;
- cartão de publicação manual em um dos quatro cantos;
- intervalo de rotação de 10 a 120 segundos e validade editorial de 10, 15, 20 ou 30 minutos;
- prévia no painel, limite de 25 palavras e importação local de RSS/XML/JSON.

O cartão social pode servir para colar manualmente o texto/link de um post, mas hoje não consulta o X. O GC também não oferece subtítulo nem imagem; portanto o pacote descrito ainda não está completo como “wall informativo”.

## Mudanças recomendadas no painel

1. **Editor visual por canal:** ligar/desligar ticker, GC, imagem e cartão social; selecionar posição segura, tema, tamanho e animação; pré-visualizar sobre um frame de vídeo 16:9.
2. **Campos editoriais:** título, subtítulo/linha fina, fonte, imagem opcional e crédito/URL. Validar título/subtítulo e limites antes de aprovar. Usar imagem por URL HTTPS, com prévia e validação de carregamento; não guardar binários grandes dentro do documento Firestore.
3. **Fila da redação:** estados “rascunho”, “aprovada”, “no ar” e “expirada”; horário de publicação e duração por item; botão para retirar imediatamente; filtro para notícias e posts sociais.
4. **Ticker de pauta:** texto curto, urgência, prioridade, deduplicação por link e prévia. A redação deve indicar que RSS importado é conteúdo pendente até aprovação.
5. **Tweets/posts:** oferecer colagem manual como primeiro fluxo. Só adicionar “buscar repercussão automaticamente” com API oficial e orçamento/credencial aprovados; não usar scraping não oficial.

## Pacote na TV

- Um lower third com faixa de categoria/fonte, título forte e subtítulo menor, fundo de alto contraste e largura limitada para manter o vídeo visível.
- Ticker na borda inferior, acima da barra do player, com selo “AO VIVO/URGENTE”, fonte legível em TV grande e velocidade configurável.
- Cartão social na direita, em uma área segura que não cubra relógio, GC, controles nem rostos; autor, texto e link/fonte. O código atual usa uma posição inferior fixa de 280 px para o cartão, que não se adapta a diferentes resoluções/controles e precisa ser substituída por uma área segura configurável.
- Respeitar modo de tela limpa: notícia só fica visível enquanto houver item publicado e dentro da validade; esconder sobre menu/EPG/modais; urgente pode ter estilo próprio, sem piscar agressivamente.
- Fallback quando a notícia expirar ou não houver publicação: manter a live limpa e não mostrar cartão vazio.

## Automação gratuita: limites

- **Sem custo adicional imediato:** redação e aprovação manuais usando a conta Firestore existente. O Firestore Standard tem cota gratuita de 50.000 leituras/dia, 20.000 gravações/dia e 1 GiB de dados na base elegível. Cada tela de TV assinante lê o documento publicado e atualizações consomem leituras; acompanhar a cota conforme a audiência crescer. [Cotas oficiais do Firestore](https://firebase.google.com/docs/firestore/pricing).
- **RSS automático:** tecnicamente possível sem taxa de software, com um agendador executando um importador seguro, deduplicando e gravando itens como rascunho. GitHub Actions é gratuito para runners padrão em repositórios públicos; repositórios privados seguem a franquia do plano. Agendamentos podem atrasar quando há carga e não servem como garantia de pontualidade editorial. [Cobrança do GitHub Actions](https://docs.github.com/en/actions/concepts/billing-and-usage) e [limitações de agendamento](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
- **n8n:** o software pode ser auto-hospedado, mas exige máquina/servidor sempre ligado e manutenção; “software sem mensalidade” não significa infraestrutura sem custo. A aplicação não precisa de n8n para começar.
- **Busca automática de publicações no X:** não considerar gratuita até conferir/contratar o modelo de créditos vigente. A plataforma X descreve a API como pay-per-use; acesso a busca por assunto exige chave e pode gerar custo. [Plataforma de desenvolvedores X](https://developer.x.com/).
- **Alternativa inicial para repercussão:** curadoria manual de posts públicos ou importação editorial de fontes RSS. Embed oficial de um post individual pode ser avaliado, mas não substitui uma busca automática por hashtag e depende de disponibilidade do embed/rede.

## Riscos e correções técnicas antes de ativar automação

- Não colocar chave de API do X nem credencial de serviço Firebase no bundle React. Um importador automático precisa executar no servidor/CI com segredo fora do cliente e gravar somente em rascunhos.
- As regras atuais protegem `newsDrafts` para administradores e permitem leitura pública de `newsPublished`, coerente com a TV. Manter a aprovação editorial antes de mover RSS para a coleção publicada.
- A publicação é uma gravação em lote Firestore; validar no painel autenticado que o usuário tem autorização administrativa, que o canal ainda existe e que erro/timeout não deixa a redação parecer publicada quando a promessa falhou.
- Revisar o canal 30: no teste público havia um intervalo sem atração até a meia-noite. Se a intenção é ter live contínua, corrigir a grade e/ou o ciclo Eternity desse canal.
- A imagem editorial requer limite de tamanho visual, fallback quando a URL quebra, e política de cache. Preferir URL externa otimizada ou armazenamento apropriado, sem embutir base64 no documento.

## Sequência sugerida

1. Refinar o editor existente com subtítulo, imagem, layout e posição adaptativa; testar publicar, retirar, expirar e alternar canal numa sessão autorizada.
2. Ajustar GC/ticker/cartão para zonas seguras e testar em 16:9, 720p/1080p e telas menores.
3. Acrescentar ingestão RSS como rascunhos com deduplicação, atribuição da fonte e aprovação obrigatória.
4. Reavaliar a audiência/cota Firestore e só então decidir automação de posts X via API oficial.

## Validação do código local

- `npm test`: aprovado (2 arquivos de teste; zero falhas).
- `npm run build`: aprovado. O bundler mantém um aviso de chunk principal acima de 500 KB; não impediu a compilação.
- A redação autenticada não foi exercitada na versão publicada por falta de sessão; as recomendações sobre seu comportamento vêm da leitura dos componentes e regras.
