# TREND TV

Projeto React/Vite com Firebase Auth e Firestore. Inclui Home, guia contínuo, TV normal/estúdio e Admin.

## Instalação e publicação

Use Node >=22.12.0. Execute npm ci e npm run check. Publique o projeto completo na Vercel, build npm run build, saída dist. As funções em api/ são necessárias; enviar apenas dist não basta. Para testar as funções localmente, use vercel dev.

Configure YOUTUBE_API_KEY no servidor, habilitando a YouTube Data API v3. A chave não é enviada ao navegador. Preserve YOUTUBE_LIVE_CHANNEL_IDS e YOUTUBE_LIVE_HANDLES para descoberta automática de lives; fontes diretas continuam disponíveis. Use .env.example como referência. Publique as regras de firestore.rules no seu projeto Firebase.

O Admin usa Firebase Authentication e exige admins/UID com enabled=true. Não há senha fixa embutida; a sessão é limitada a oito horas.

## Estúdio por canal e tela cheia

Admin → Canais → editar → Permitir modo estúdio neste canal. Canais habilitados começam no estúdio; o espectador pode escolher o modo ampliado. A escolha é isolada por canal. Canais sem habilitação ficam no modo normal. Para compatibilidade, canais antigos com pacote editorial ativo são considerados habilitados até o administrador salvar explicitamente essa opção.

Entrar em tela cheia mantém o layout atual. Relógio, GC e mensagens continuam compondo o estúdio. Redação permite escolher cor e uma ou duas manchetes compactas.

## Lives e 2×

A URL da live pode ser inserida no programa ou na Live padrão do canal em Redação; essa última cobre somente lacunas da grade. A redução de atraso vem ligada ao entrar em um canal e só usa 2× quando a API confirma que o vídeo está realmente ao vivo. Vídeos gravados, agendados/upcoming, lives encerradas e estados não confirmados permanecem em 1×. Quando 2× estiver disponível, aparece a animação de redução de atraso e a velocidade volta a 1× perto do ao vivo. Alguns streams não suportam 2×; anúncios e buffering não são eliminados por essa opção. A confirmação é atualizada em ciclos de 30 segundos, podendo haver atraso para detectar o encerramento; o fim do player também restaura 1×.

## Redação e remoção

Cadastre até cinco fontes HTTPS RSS/Atom/JSON por canal. É possível atualizar enquanto o painel está aberto e optar por publicar automaticamente. Para posts individuais, use Importar tweet pelo link; depende do texto disponibilizado pelo serviço público de incorporação do X.

Remover da TV e fila retira o conteúdo publicado imediatamente após confirmação do Firestore, apaga a cópia persistida no rascunho e grava um bloqueio de reimportação automática. A Redação também carrega os itens que chegaram diretamente ao publicado pelo importador externo. Edições manuais concorrentes são protegidas por transações/condições de versão. A retirada na TV depende da conexão e da atualização do listener do Firestore.

## Importação contínua e playlists às 22h

Para funcionar com o Admin fechado, scripts/editorial_worker.py deve permanecer rodando em uma máquina ligada. O mesmo processo atualiza notícias e sincroniza as playlists habilitadas no programa, diariamente a partir das 22h de Brasília. Se iniciado depois das 22h, faz a atualização pendente; alterações posteriores à sincronização serão buscadas no dia seguinte.

No editor de programa, informe Playlist original, marque Atualizar automaticamente e salve. Buscar e importar playlist agora permite testar/importar pela API do servidor. Essa opção importa uma playlist conhecida por URL; não pesquisa títulos de playlists em todo o YouTube.

A sincronização mantém duração e horários da grade, preserva a ordem do YouTube e inclui até 200 vídeos gravados incorporáveis com duração válida. Playlists maiores, vazias ou sem vídeos disponíveis não substituem a lista atual. A TV mantém a lista de mídia já em reprodução até o próximo bloco/segmento, evitando saltos durante a atualização. Recarregar a página carrega a versão mais recente.

Para configurar o processo no Windows:

1. Crie uma conta de serviço no Google Cloud/Firebase com Cloud Datastore User e guarde a credencial JSON fora da pasta pública e do repositório.
2. Instale dependências e inicie em PowerShell:

```powershell
py -m pip install -r scripts/requirements-editorial.txt
$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\TrendTV-segredos\conta-servico.json'
$env:FIREBASE_PROJECT_ID = 'tvweb-71058'
$env:YOUTUBE_API_KEY = 'SUA_CHAVE_CONFIGURADA_NESTA_MAQUINA'
py scripts/editorial_worker.py
```

A chave configurada na Vercel não é copiada automaticamente para esse processo. Não publique credenciais no site. Configure o Agendador de Tarefas se quiser iniciar o processo com o Windows; --once permite rodadas avulsas. Limites de cota/infraestrutura continuam sendo aplicados pelos provedores.

## Possibilidade de scraping de listas do X

É tecnicamente possível usar um navegador automatizado para ler uma lista acessível e transformar os posts em JSON compatível com a Redação. Normalmente exige máquina ligada, sessão de navegador e manutenção de seletores/rolagem; login, bloqueios e mudanças de página tornam esse método instável. Gratuito em licença não significa operação sem manutenção ou infraestrutura. O próprio frontend na Vercel não oferece essa coleta contínua por navegador.

Os termos vigentes do X restringem scraping sem autorização expressa. Portanto esta entrega avaliou a possibilidade, mas não implementou nem testou um coletor de listas do X. Continua disponível a importação de links individuais e de feeds RSS/JSON fornecidos por integração autorizada.

Referências: https://x.com/en/tos · https://developers.google.com/youtube/v3/docs/playlistItems/list · https://developers.google.com/youtube/v3/docs/videos

## Testes e limites da entrega

npm run check executa regressões, componentes simulados e build. Os testes Python verificam o importador e a sincronização. Nesta entrega passaram 83 testes JavaScript, 19 verificações de componentes/gravação simulada e 17 testes Python (editorial, playlists e descoberta de lives).

Não houve deploy, configuração de credenciais/fontes reais nem teste end-to-end em navegador nesta entrega. O pacote mantém somente código, configuração, ícones/PWA, scripts necessários, testes e este guia; relatórios e logs de atualizações antigas foram retirados do ZIP.


## Grade automática 24h e reader HLS (nova versão)

Admin → Canais → editar → Programação automática:

- Playlists aleatórias: preenche todas as lacunas com os programas/modelos selecionados na base de reserva. Selecione músicas, documentários e programas de acordo com o tema do canal.
- Live + playlists de reserva: informe @handle/ID UC e/ou URL inicial do YouTube, ou uma URL HLS HTTPS. Cadastre a mesma base de reserva para quando a live estiver ausente.
- Somente grade manual: mantém o funcionamento manual anterior; lacunas ficam sem mídia automática.

Escolha blocos de 15, 30, 60, 120 ou 180 minutos e se deseja embaralhar os vídeos. O modo automático exige pelo menos uma fonte de reserva com vídeos do YouTube válidos, duração conhecida e sem marcação de bloqueio. Use Buscar Todos no programa para completar os metadados. Modelos só são usados como reserva quando selecionados; não viram programas agendados por conta própria.

A grade é calculada continuamente para hoje e amanhã e permanece cheia a cada nova data, sem precisar gravar milhares de programas artificiais no Firestore. A mesma regra/seed é usada na Home, guia e TV, dando a mesma ordem para espectadores que usam a mesma base. A ordem muda diariamente e os vídeos podem mudar por bloco. Os horários manuais e as vinhetas têm prioridade. Atualizar uma playlist não substitui a mídia já iniciada na TV antes do próximo segmento.

A descoberta automática funciona em dois caminhos:

1. Com o site aberto, o catálogo consulta canais de live a cada 5 minutos, usando a rota pública com cache compartilhado de até 15 minutos. O catálogo é comum à Home/TV. Configure YOUTUBE_LIVE_CHANNEL_IDS e YOUTUBE_LIVE_HANDLES para esse caminho.
2. Com o importador contínuo rodando, ele atualiza os metadados compartilhados dos canais a cada 15 minutos, mesmo com o site fechado. Verifica uploads recentes e a live anterior; uma busca geral de apoio é feita no máximo a cada seis horas quando necessário. O cliente usa os metadados recentes do importador para evitar duplicar pesquisas. Configure YOUTUBE_API_KEY também na máquina do importador.

Quando a busca confirma ausência de live, o canal passa às playlists de reserva. Quando encontra uma nova transmissão, o catálogo e a TV passam a exibi-la. A mudança depende do intervalo/cache, da disponibilidade da API e da cota do projeto. Uma transmissão descoberta há pouco pode terminar antes da atualização seguinte. Os blocos da grade de live representam cobertura automática e não uma previsão de assuntos que ainda não foram anunciados.

Para HLS/m3u8, informe a URL no canal automático ou no programa marcado como live. O leitor usa HLS nativo quando disponível e HLS.js nos navegadores compatíveis. A URL e os segmentos precisam usar HTTPS, ser acessíveis ao espectador e permitir CORS para o player; DRM, cookies de acesso e streams restritos não são implementados. A URL pode conter query/token, mas o site não renova tokens externos automaticamente. HLS recebe prioridade sobre a URL YouTube quando ambas são preenchidas.

HLS fica sempre em 1×; o botão e a animação de recuperação em 2× continuam exclusivos do YouTube quando a API confirma uma live ativa. O pacote gráfico funciona com ambos os players. O importador verifica se o manifesto HLS responde a cada 15 minutos e seleciona a reserva quando estiver indisponível. Esse teste de manifesto não garante que todos os segmentos/CORS/codecs funcionem no navegador.

A continuidade depende de configurar e manter pelo menos uma fonte reproduzível. A aplicação não inventa vídeos quando a base está vazia, todos os vídeos estão bloqueados ou as fontes externas deixam de funcionar. Sem importador ligado, não há atualização persistente com o site fechado; as buscas continuam quando alguém abre a Home/TV.

A validação desta entrega foi local, com serviços simulados e renderização SSR. Não foi feito deploy nem reprodução end-to-end de uma live HLS real. O ZIP continua limpo, com código/configuração, scripts, testes e este guia.


## Correção de compatibilidade, RSS e Bright Data

Tweets/trends agora desaparecem ao sair do modo estúdio. Redação → Exibição na TV → Manter tweets no modo normal em canais de live permite a exceção por canal. Essa opção vem desligada e exige publicar a configuração; o pacote social continua respeitando seu próprio checkbox.

Na leitura do catálogo público em 13/10/2026, quatro canais não tinham autoMode e um estava explicitamente em off; nenhum possuía uma base selecionada. Para corrigir a compatibilidade, canais sem autoMode agora aproveitam automaticamente programas gravados do próprio canal como reserva. Quando há uma fonte de live padrão, ela é priorizada. O modo off explícito continua sendo respeitado; Canais tem um botão para ativar a reserva usando o acervo existente. Canal sem vídeo disponível precisa receber uma base de outro canal ou novos programas. Nenhum dado real foi modificado durante a análise.

Vídeos sem duração individual agora usam estimativa baseada na duração do programa, como já acontecia no player antigo. Para horários precisos, complete as durações pela API (Buscar Todos). Programas/modelos selecionados explicitamente continuam controlando a base; modelos não são escolhidos automaticamente para canais antigos.

RSS: redirecionamentos HTTPS públicos agora são seguidos, com validação de cada destino e limite de saltos. Codificação ISO-8859-1 também é aceita. Importações expiradas marcadas como automáticas deixam de ocupar a fila; rascunhos manuais são preservados. O histórico de importação evita renovar repetidamente o mesmo conteúdo. A publicação automática pode tentar novamente itens pendentes depois de uma falha. O painel mostra o erro específico da fonte, incluindo sessão expirada; a sessão admin segue limitada a oito horas, exigindo novo login depois desse prazo. Importações antigas sem marcador não são apagadas automaticamente.

A Bright Data é compatível por sua API de snapshots. Nesta versão, Redação → Importação simples e automática → Bright Data permite conectar um snapshot s_… já criado no provedor. Configure BRIGHTDATA_API_TOKEN no servidor Vercel (sem VITE_) e, para importação com painel fechado, também na máquina do importador. O serviço consulta o progresso da coleta, aguarda estar ready e lê até os primeiros 100 posts. Texto, perfil e link são convertidos para tweets da Redação; a publicação segue a opção de revisão/publicação automática já configurada. Também é possível importar o JSON exportado, respeitando o limite do painel.

Esta integração não inicia coletas, não busca automaticamente listas do X e não descobre sozinha novos snapshots. A coleta e seu agendamento ficam na Bright Data; atualize o ID ou forneça um feed JSON continuamente atualizado para receber novos lotes. Não foi usada uma conta/token Bright Data real nesta entrega. Snapshots prontos são lotes de dados, não feeds que recebem posts novos continuamente.

Em 13/10/2026, a página oficial anuncia cinco mil créditos mensais para novas contas, compartilhados com outros produtos, sem cartão de crédito. A seção de preços do Twitter mostra US$1,50 por mil registros no pagamento por uso, enquanto o menu mostra outra promoção. Portanto US$0,75/APIS25 não deve ser tratado como preço garantido da sua conta. Confira o benefício e limites no painel do provedor. Referências: https://brightdata.com.br/products/web-scraper/twitter · https://docs.brightdata.com/api-reference/scrapers/delivery-apis/download-snapshot

Testes locais e simulados passaram. Não houve deploy, edição do banco real, teste em navegador com login nem importação de um RSS real da sua conta nesta entrega. O ZIP permanece sem arquivos antigos de atualização. Se um feed específico continuar falhando, seu link e a mensagem agora exibida serão necessários para investigar esse caso.
