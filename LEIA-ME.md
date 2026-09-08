# TREND TV — versão revisada

Este ZIP contém o projeto completo, com código atualizado, dependências, configuração de build, PWA, regras de acesso e testes. Use o pacote inteiro: os sete arquivos originais agora compartilham módulos auxiliares.

## Começar

1. Extraia o ZIP em uma pasta nova. Nesta distribuição, `main.jsx`, `index.html` e `package.json` ficam na raiz.
2. Use Node.js 22.12 ou mais recente.
3. Execute:

```bash
npm ci
npm run dev
```

Para gerar a versão de produção:

```bash
npm test
npm run build
```

A pasta `dist` é gerada pelo build. Para a Vercel, o arquivo `vercel.json` já informa o comando, a pasta de saída e as rotas `/tv`, `/canal/:id` e `/admin`. Se integrar em um repositório existente cuja aplicação esteja em `src/`, mova os módulos JSX/JS da aplicação juntos e ajuste o caminho de `main.jsx` no `index.html`; mantenha as configurações na raiz.

## Configuração única do novo Admin

**A senha compartilhada antiga foi removida. O novo acesso depende do Firebase Authentication e das regras incluídas.** Uma senha `VITE_ADMIN_PASSWORD` era exposta no JavaScript e não protegia escritas no banco.

A configuração pública do projeto Firebase original foi preservada em `firebase.js`. Nenhuma alteração foi aplicada à conta, aos usuários, aos dados ou às regras remotas durante esta revisão.

1. No Console Firebase do seu projeto, abra Authentication e habilite o provedor **E-mail/senha**.
2. Em Usuários, crie sua conta de administrador e copie o UID.
3. No Firestore, crie a coleção `admins`. Crie um documento cujo ID seja exatamente esse UID e adicione `enabled` como **booleano** `true`.
4. Revise e publique o conteúdo de `firestore.rules` na aba Regras. Se o mesmo banco servir outros aplicativos, integre as permissões necessárias deles: o arquivo fornecido fecha coleções não utilizadas pela TREND TV.
5. Nas configurações do Authentication, confira os domínios autorizados do seu site e de desenvolvimento.
6. Abra `/admin` e entre com o e-mail/senha criados.

O público pode ler canais, programação e notícias publicadas. Rascunhos exigem administrador. Criar uma conta comum não concede acesso administrativo. A validade de oito horas é verificada também nas regras; uma sessão vencida exige novo login. O botão Sair encerra a sessão.

Canais antigos com número zero continuam acessíveis pelo link antigo, mas precisam receber um número positivo e único no editor antes de outras atualizações nesse cadastro. O painel reserva números novos em transações; numerações antigas duplicadas precisam ser ajustadas pelo administrador.

## Metadados do YouTube

Crie `.env.local` com base em `.env.example` e preencha `VITE_YOUTUBE_API_KEY` para buscar títulos, durações e importar playlists do YouTube. Ative a YouTube Data API v3 para essa chave. Restrinja-a aos domínios autorizados e a essa API no Google Cloud.

Uma variável `VITE_*` é pública no build; nunca coloque senha, chave de conta de serviço ou segredo nela. O player continua funcionando sem essa chave. Sem consultas de metadados, use links de vídeos e informe suas durações em segundos. Em playlists com vários vídeos, os tempos exatos são necessários para manter a transmissão sincronizada.

A importação consulta até 50 IDs por chamada e aceita até 200 itens de uma playlist; playlists maiores são recusadas com aviso, para evitar importação silenciosamente incompleta. “Incorporável” não garante reprodução em todo país, dispositivo ou conta: o player ainda trata erros reais.

## Grade e transmissão

- Horários usam `America/Sao_Paulo` em todos os componentes, inclusive quando o espectador está em outro fuso. `VITE_BROADCAST_TIMEZONE` pode alterar isso no build.
- Programas atravessando meia-noite e blocos de maratona preservam a posição original do vídeo.
- No eternity, os N dias a partir da âncora formam o ciclo. O botão **Criar ciclo aleatório de 7 dias** usa a grade real do dia selecionado, preenche os seis dias vazios seguintes, embaralha programas e playlists e ativa um ciclo de sete dias em uma única gravação.
- O painel continua mostrando a origem de ciclos antigos. Editar uma projeção abre o cadastro original.
- Vinhetas entram no horário agendado e têm prioridade. Ao terminar, o programa retorna à posição correspondente ao relógio; o intervalo não empurra toda a grade.
- Um vídeo bloqueado fica indisponível até o próximo item previsto. Não se adianta a grade para ocupar esse tempo. Erros de bloqueio detectados durante reprodução expiram do cache após seis horas; marcações editoriais `blocked` podem ser atualizadas por Buscar Todos.
- Programas com data passada não voltam a tocar automaticamente quando eternity está desligado. Grades antigas sem data mantêm compatibilidade com repetição.
- Organizar horários preserva as durações e os programas antigos. Duplicar dia pede confirmação antes de substituir um destino preenchido.

## Notícias e publicações

Na aba **Notícias**, escolha um canal, habilite os formatos desejados e crie/importе itens. “Salvar rascunho” não altera o que está no ar. Marque cada item aprovado e use “Publicar na TV”.

São fornecidos ticker, manchete em destaque e card de publicação manual com autor/fonte e link. O card é um layout editorial da TREND TV, não um tweet consultado pela API do X. O intervalo de rotação e o canto são configuráveis. Notícias urgentes recebem destaque; cada item permanece no ar por 10, 15, 20 ou 30 minutos a partir da publicação. Apenas até 50 itens aprovados, com título/fonte e dentro da validade são publicados. A redação aceita até 100 itens e limita cada manchete a 25 palavras e 240 caracteres.

Importe arquivos RSS/XML, Atom ou JSON pelo botão do painel. Todas as importações entram como rascunho sem aprovação. A revisão usa manchetes e links, sem copiar matérias completas. O script opcional `scripts/rss_to_json.py` converte um RSS público em um arquivo que pode ser importado:

```bash
python scripts/rss_to_json.py "URL_DO_FEED" noticias.json
```

Esse fluxo já funciona sem n8n. Buscar notícias automaticamente em intervalos, com a redação fechada, exige configurar um executor separado. Não existe tarefa agendada nem integração externa ativada neste pacote.

## Celular, preferências e PWA

A Home ganhou cartões por toque, favoritos no topo, busca por canal/programa e detalhes com imagem. A TV tem atalhos M (som), H (início), F (tela cheia), G (guia), S (configurações) e ↑/↓ (canais). Campos de texto não acionam esses atalhos. O compartilhamento usa a origem atual do site e o número do canal.

Favoritos, último canal e ajustes ficam no navegador. O Firestore usa cache persistente com suporte a múltiplas abas. O service worker guarda a interface; os vídeos e feeds externos continuam exigindo internet. O PWA possui manifest e ícones tipográficos provisórios “TV”, que podem ser substituídos pela marca oficial. Atualizações aguardam o fechamento das abas anteriores para não interromper o vídeo. A instalação depende do suporte do navegador e de HTTPS.

As imagens enviadas ao painel são reduzidas localmente antes de salvar, para respeitar o limite de documento. Imagens animadas enviadas por esse fluxo viram uma imagem estática. Os dados de cache podem ser removidos pelo navegador ou pelo usuário.

## Verificação e limites

- Build de produção concluído.
- 22 testes de regressão aprovados: fuso, calendário, datas, meia-noite, maratona, eternity, vinhetas, conflitos, playlists, URLs e publicação editorial.
- Não foram feitos testes visuais em navegador/celular, reprodução real do YouTube, instalação em dispositivos ou testes contra a conta Firebase do usuário. As regras foram fornecidas, mas não executadas no emulador nem publicadas.
- Operações de lote usam gravação atômica, confirmação do servidor e limite conservador de 450 alterações. Conflitos de grade são validados no painel; edições concorrentes de dois administradores ainda precisam de coordenação. Somente a reserva de numeração usa transação entre administradores.
- O bundle inicial ainda contém os SDKs React/Firebase e gera aviso de tamanho do Vite. As telas são carregadas separadamente.

Consulte `ANALISE-E-CUSTOS.md` para a revisão e o que pode funcionar sem mensalidade.
