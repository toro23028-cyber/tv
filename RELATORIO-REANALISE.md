# TREND TV — reanálise e correções

Data: 12/10/2026. Revisão do código disponível neste projeto; não é uma auditoria da instalação publicada na Vercel.

## Resultado

Revisados: App/autenticação, catálogo Firebase, Home, Admin, modelos, grade visual/lista, Eternity, TV, player YouTube, descoberta de lives, redação, pacote gráfico, relógio, preferências, PWA, build, regras Firestore e importador RSS.

A entrega contém o código corrigido, este relatório e o registro da execução dos testes. Nenhuma gravação foi feita no Firebase de produção e nenhuma versão foi publicada na Vercel nesta revisão.

## Correções aplicadas

| Área | Problema encontrado | Correção |
| --- | --- | --- |
| Calendário | Datas como 30/02 eram convertidas silenciosamente para março | Verificação estrita do dia, mês e ano; teste de ano bissexto |
| Grade | Horários negativos, infinitos ou fora do dia podiam chegar à projeção | Filtragem de registros inválidos antes de construir a transmissão |
| Validação Admin | Canal ausente, nome vazio e data inválida não eram rejeitados na validação compartilhada | Validação centralizada em `program-validation.js`; horários e durações em segundos inteiros |
| Grade visual | Mover/alongar um programa checava somente os blocos do dia visível | Validação contra o catálogo completo, incluindo conflitos no dia seguinte |
| Grade visual | Cancelar o gesto podia disparar a gravação | Cancelamento descarta o movimento |
| Modelos | Um modelo sobreposto à grade recebia erro de conflito como se fosse uma transmissão | Modelos não participam da validação de sobreposição; editor usa início neutro e permite modelo sem vídeos |
| Modelos | Duplicar um dia também duplicava os modelos | Cópia/substituição de dia exclui modelos e preserva os existentes |
| Modelos | Aplicar padrão não copiava/resetava corretamente live e GC desativado | Formulário transfere configuração live/canal e `gcNever` |
| Playlist | Checkboxes selecionavam vídeos sem uma ação correspondente | Ação “Remover selecionados”; seleção é limpa quando a lista muda |
| Importação | Mensagem contava vídeos repetidos como adicionados | Contagem de adicionados e repetidos ignorados |
| Gravação | `batch.commit()` começava antes da checagem offline | Gravação só é iniciada depois da checagem de conexão |
| Gravação | Após confirmação do lote, esperava todas as outras gravações pendentes do banco | Removida a espera global; confirmação corresponde à operação enviada |
| Exclusão em lote | Exclusões sequenciais podiam deixar uma seleção parcialmente removida | Um único lote; seleção é preservada quando há erro; limite de 450 operações mantido |
| Admin | Seleção persistia ao mudar de área; clonagem fechava o menu antes de saber se salvou | Troca de área limpa seleção/menu; falha de clonagem mantém o menu |
| Modal | Fechar durante salvamento podia descartar o contexto visual | Fechamento bloqueado durante envio; IDs novos usam UUID |
| Catálogo | Mensagem de erro permanecia após recuperação das assinaturas | Mensagem limpa quando as assinaturas voltam a funcionar |
| Live/playlist | Segurança da separação de velocidade dependia somente do componente pai | Player também exige `isLive` para acelerar; live não recebe deslocamento de início da playlist |
| Live bloqueada | Bloqueio identificado pelo iframe não era considerado no ID obtido automaticamente | TV considera o ID da live no estado de bloqueio e mostra a mensagem correspondente |
| Live automática | Erro de configuração do servidor virava mensagem genérica | Motivo da falha aparece na TV |
| Live automática | Consultas de handles não autorizados podiam consumir API antes da autorização | Handle precisa ser autorizado antes de consultar o YouTube; resposta validada para canal e ID de vídeo |
| Pacote gráfico | Arte inteira do estúdio podia entrar no player normal | PNG completo reservado ao Estúdio/prévia; modo normal usa elementos compactos |
| Pacote gráfico | CSS antigo deixava fundo claro em manchete com texto branco | Reset de fundo, borda e padding herdados |
| TV | GC musical e editorial podiam aparecer simultaneamente | GC musical é suprimido quando o canal usa o pacote editorial |
| Celular | Coluna social podia cobrir o vídeo no Estúdio | Áreas separadas para vídeo, mensagens, manchete e ticker em telas estreitas |
| Redação | Item publicado sem validade ganhava nova expiração a cada atualização | Validade obrigatória para conteúdo publicado |
| Redação | Lista malformada podia derrubar a renderização; mais de 50 aprovados eram cortados silenciosamente | Leitura defensiva e mensagem explícita para reduzir a publicação a 50 itens |
| Teclado | Setas de navegação podiam trocar canal com botão/link focado | Controles focados preservam as setas |

## Testes executados

`npm run check` reúne:

- **41 testes de regras e regressão**, todos aprovados: calendário/fuso, virada de dia/ano, Eternity, playlist por segundo, modelos, vinhetas, conflitos, duração, fontes editoriais, aprovação/expiração, limites e API de live com respostas simuladas.
- **10 verificações de integração isolada**, aprovadas: renderização dos componentes reais Home, TV, Admin, editor sem canais, modelo sobreposto à grade, pacote gráfico e operações de lote com Firebase simulado.
- **Build de produção aprovado**, com 58 módulos transformados. O SDK do Firestore continua sendo o maior arquivo (~516 KB antes da compressão). O limite de aviso de 550 KB já existia; ausência de warning não significa que esse arquivo seja pequeno.
- `node --check` aprovado para a API, validações, camada de gravação e service worker gerado.
- Importador Python validado com `py_compile`.

Registro integral: `testes-revisao.log`.

### O que esses testes não confirmam

- Não houve captura/teste visual em navegador: o download do Chromium neste ambiente falhou. Renderização de componentes verifica HTML e erros de execução inicial, não geometria, rolagem, foco ou animações.
- Não houve reprodução real de live, teste de aceleração no YouTube, teste em Smart TV nem simulação de controle remoto físico.
- Não houve autenticação ou gravação real no Firebase; as regras Firestore foram revisadas por leitura, sem executar o emulador.
- Build e testes locais não verificam se variáveis, regras e arquivos foram instalados na hospedagem atual.

## Configuração que mudou

Para fonte Live, prefira ID UC do canal, autorizado em `YOUTUBE_LIVE_CHANNEL_IDS`.
Se usar `@handle`, adicione também o handle em `YOUTUBE_LIVE_HANDLES`, separado por vírgula. O ID UC correspondente continua na lista de IDs. `YOUTUBE_API_KEY` continua sendo segredo do servidor.

Para GC/tweets: Admin → Redação → escolher canal → ativar pacote → adicionar/liberar itens → publicar. Salvar rascunho não publica. Tweets e trending topics atuais são inseridos manualmente; não há coleta automática da API do X.

## Pontos que precisam de decisões ou infraestrutura

1. A descoberta automática de live é consultada pelo player e usa cache; **não é o agendamento diário de atualização de playlists às 22h**. Essa automação ainda precisa de implementação no servidor.
2. Gerar sete dias copia/embaralha a grade de origem. Se o dia de origem tiver lacunas, isso não significa preenchimento de 24 horas completas. É preciso escolher uma política editorial para as lacunas.
3. Validação de conflito no cliente reduz erros, mas duas sessões Admin podem gravar ao mesmo tempo. Garantia de concorrência exige controle de revisão/bloqueio no servidor.
4. Timeout não cancela uma gravação já enviada. Se o servidor não confirmar, conferir o resultado antes de repetir operações de criação/cópia.
5. O catálogo público escuta todos os programas, inclusive modelos filtrados da tela. Modelos não devem conter informação privada; a separação deles em coleção privada é uma evolução recomendada.
6. Picture-in-picture de iframe YouTube não é uma integração de uma linha. Precisa de prova de compatibilidade do navegador e do player.
7. Aceleração não elimina o atraso da origem da live nem resolve todos os casos de buffering; deve manter estado de compatibilidade/retorno a 1×.
8. Analytics contínuo por espectador e ordenação automática podem aumentar escritas e distorcer popularidade; só fazem sentido depois de definir agregação e amostragem.

## Melhorias sugeridas — ordem de complexidade

Complexidade relativa ao projeto atual; inclui implantação e validação, não apenas quantidade de código.

| Ordem | Complexidade | Melhoria | Benefício / condição |
| --- | --- | --- | --- |
| 1 | Baixa | Busca/filtros na lista do Admin | Encontrar programa, canal, live e modelo rapidamente |
| 2 | Baixa | Padronizar os ícones restantes em SVG | Acabar com diferenças de aparência dos emojis entre Android, desktop e TV |
| 3 | Baixa | Resumo de pendências no painel | Alertar sobre canal sem grade, fonte de live ausente, item editorial expirado |
| 4 | Baixa a média | Prévia real do Estúdio dentro da Redação, com modo desktop/celular | Revisar manchete, imagem, tweets e ticker antes de publicar |
| 5 | Média | Exportar/importar backup de grade e modelos com prévia de conflitos | Recuperação de conteúdo e cópia entre ambientes |
| 6 | Média | Atualizar playlists diariamente no servidor | Persistir ID de origem, horário, última execução, erros; aplicar nova versão sem interromper a atração atual |
| 7 | Média | Cache central de lives por ID UC e controle de cota | Reutilizar descoberta entre aliases/regiões e reduzir consultas repetidas |
| 8 | Média | Histórico de publicação e reversão da redação | Recuperar um GC ou fila de mensagens anterior |
| 9 | Média a alta | Política de preenchimento de lacunas no Eternity | Definir repetição, reserva, vinhetas e horários protegidos para completar o dia |
| 10 | Alta | Edição concorrente protegida + auditoria | Evitar que um editor substitua mudanças de outro e registrar operações |
| 11 | Alta | Navegação completa por controle remoto e teste em TVs reais | Foco previsível, retorno, setas e teclado em modelos de TV diferentes |
| 12 | Alta | RSS automático com aprovação editorial | Coleta, deduplicação, fonte, revisão, validade e publicação seguras |
| 13 | Alta / dependente de serviço | Tweets e trending topics automáticos | Depende da disponibilidade, permissões e custos da fonte externa; manual já funciona |

### Viabilidade sem novos serviços pagos

Busca, filtros, SVGs, prévia, backup local e histórico podem ser construídos no stack atual; uso de hospedagem/banco continua sujeito às cotas existentes.

Para atualização diária de playlists, Cron da Vercel existe no Hobby, mas executa no máximo uma vez por dia e não garante o minuto: um job das 22h pode ser acionado dentro dessa hora. Portanto, não prometer 22:00 exatas nesse plano. Será necessário configurar a função autenticada e acesso de servidor ao Firebase; isso não foi implantado nesta revisão.

A documentação atual do YouTube informa cota padrão de 100 chamadas `search.list` por dia. Cache CDN não garante um teto global de consultas porque aliases, regiões e requisições concorrentes podem gerar misses. Planejar a expansão de canais com medição de cota.

Fontes oficiais consultadas:
- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://developers.google.com/youtube/v3/getting-started
- https://developers.google.com/youtube/v3/docs/search/list

**Prioridade prática:** backup e atualização diária de playlists; depois histórico editorial, cache central e concorrência. Antes de publicar, validar manualmente as telas em navegador e a reprodução em uma TV real.
