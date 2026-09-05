# Análise do projeto e viabilidade gratuita

Revisão do código do ZIP fornecido. Consulta de documentação: 5 de setembro de 2026. Nenhuma configuração de produção foi alterada.

## Falhas corrigidas

| Achado no código recebido | Correção aplicada |
|---|---|
| A TV combinava data UTC com hora local | Relógio de transmissão compartilhado, com fuso explícito |
| A grade da TV ficava memorizada depois da meia-noite | Data incluída na dependência do cálculo |
| A Home usava o primeiro programa do dia como fallback “ao vivo” | Ao vivo apenas dentro do intervalo real |
| Programas expirados repetiam mesmo sem eternity | Fallback restrito a cadastros antigos sem data |
| Eternity no painel perdia a base antiga por filtro de sete dias | Projeção baseada em todos os cadastros e acesso à data de origem |
| Vinhetas eram filtradas antes da exibição | Vinhetas participam da transmissão, com prioridade e retomada sincronizada |
| Durações consultadas eram truncadas em minutos | Duração exata em segundos por vídeo e por programa |
| Trocas/ativação de som podiam recriar o iframe e reiniciar playback | API oficial com controle do som e ressincronização |
| Mensagens de erro de iframe não validavam a origem | Uso dos callbacks da API oficial |
| Duplicar dia e reordenar apenas mudavam estado local | Persistência atômica no Firestore |
| Clonagem perdia campos e havia referência a `setError` inexistente | Cópia dos campos completos, validação e tratamento de erro |
| Salvar programa não aguardava a promessa | Espera pelo resultado e erro visível, mantendo o formulário |
| Proteção de alterações pendentes era incompleta | Detecção do formulário completo e aviso ao sair |
| “Corrigir programação” podia apagar a base antiga do eternity | Substituído por organização sem apagar o histórico |
| Upload permitia até 5 MB em um documento Firestore | Redimensionamento/compressão local e limite antes de salvar |
| Cada espectador gravava progresso no banco | Preferências locais; removidas escritas públicas desnecessárias |
| Senha do Admin estava no frontend, com valor padrão | Firebase Auth, autorização por UID e regras de banco |
| Não havia registro de service worker em `main.jsx`, apesar do resumo | Registro real, manifest, ícones, cache e build completo |

## Recursos e custos

| Recurso | Situação nesta versão | Possibilidade sem mensalidade |
|---|---|---|
| Favoritos, busca, atalhos, compartilhamento, horário automático | Implementados | Executados no navegador |
| Cache, interface responsiva e PWA | Implementados | Sem serviço adicional; vídeos continuam online |
| Metadados e importação YouTube | Implementados, chave configurável | Dentro da cota do projeto; buscas em lotes reduzem consumo |
| Ticker, manchete e card editorial manual | Implementados | Usam o Firestore existente, sujeitos às suas cotas |
| Importação RSS/JSON e aprovação | Implementadas | Arquivo local; script Python fornecido |
| RSS automático contínuo/n8n | Não ativado | Depende de um executor em funcionamento; não é necessário para usar a redação manual |
| Analytics global e ranking de popularidade | Não incluídos | Possíveis em pequena escala, mas exigem ingestão controlada, agregação e limites; abrir escrita pública criaria contagens manipuláveis e consumo de cota |
| Picture-in-picture | Não incluído | Possível em navegadores compatíveis com Document PiP, mas requer integração e testes específicos do iframe; a API de um `<video>` comum não acessa o vídeo interno do YouTube |
| Captura automática de posts/hashtag do X | Não incluída | A API oficial usa cobrança por consumo; o card manual evita essa dependência |

O Firestore oferece 1 GiB, 50.000 leituras/dia e 20.000 gravações/dia na cota gratuita de uma base por projeto. Isso não torna audiência ilimitada gratuita. A assinatura em tempo real de todos os documentos continua consumindo leituras conforme sessões e atualizações; guardar no navegador não elimina todos esses custos. [Limites oficiais do Firestore](https://firebase.google.com/docs/firestore/quotas).

A consulta `playlistItems.list` custa uma unidade por chamada. Os metadados são consultados em lotes, com cache de uma hora na sessão do painel. O consumo real depende do número de importações e do restante do projeto. [Documentação da consulta de playlist](https://developers.google.com/youtube/v3/docs/playlistItems/list), [cotas do YouTube](https://developers.google.com/youtube/v3/determine_quota_cost).

No plano Hobby da Vercel, cada cron tem frequência mínima diária e precisão por hora; não serve para atualizar um ticker a cada poucos minutos. O plano Hobby também se destina a uso pessoal não comercial, portanto um canal monetizado precisa rever a hospedagem. [Cron na Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing), [plano Hobby](https://vercel.com/docs/plans/hobby).

A API do X usa créditos com cobrança por consumo. [Preços oficiais do X](https://docs.x.com/x-api/getting-started/pricing). Para PiP, a opção que pode acomodar HTML é a Document Picture-in-Picture API, com suporte limitado. [Documentação do Chrome](https://developer.chrome.com/docs/web-platform/document-picture-in-picture/), [API oficial do player YouTube](https://developers.google.com/youtube/iframe_api_reference).

Para começar com o menor custo, use a redação manual/importação de arquivos, a cota já disponível do Firebase e metadados consultados apenas pelo administrador. Automação contínua, analytics global e PiP ficam como integrações futuras, sem botões simulando algo que ainda não foi implementado.
