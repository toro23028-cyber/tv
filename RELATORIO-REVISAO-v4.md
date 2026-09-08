# Relatório de revisão v4

Revisão realizada em 8 de setembro de 2026, concentrada no calendário do Admin, persistência da grade, modo Eternity e funções que prometiam um comportamento que o navegador não conseguia garantir.

## Problemas corrigidos

| Gravidade | Problema | Correção |
|---|---|---|
| Alta | O calendário criava e formatava datas no fuso local do navegador, enquanto a transmissão usa Brasília. Em outros fusos, o dia da semana podia ficar incorreto. | Toda a navegação de dias agora usa aritmética UTC baseada no calendário de transmissão. Foram adicionados seletor de data, dia anterior, próximo dia e retorno para hoje. |
| Alta | Uma data escolhida fora da faixa visível era trocada silenciosamente por hoje. | A data escolhida sempre integra a faixa e permanece ativa. O painel mostra 7 dias anteriores e 60 futuros, além das datas já cadastradas. |
| Alta | Salvar programa e arrastar blocos usavam caminhos diferentes de escrita. Operações offline podiam ficar indefinidamente em “Salvando”. | Programas, reordenação, arraste, redimensionamento, vinhetas e operações em lote usam a mesma persistência, com validação, limite de 20 segundos e confirmação das escritas pendentes. |
| Alta | O botão de lembrete da TV executava Hooks do React dentro de uma função comum e poderia quebrar ao clicar. A notificação também dependia da aba aberta. | O lembrete foi removido da interface. Um lembrete confiável exigiria push notification no servidor e autorização do usuário. |
| Média | O modo Eternity podia ser ligado sem qualquer grade real e então exibia apenas lacunas. | O painel impede essa ativação e explica que é preciso cadastrar uma grade base. |
| Média | Criar manualmente sete dias para o Eternity era repetitivo e sujeito a ciclos incompletos. | Nova ação cria seis dias a partir do dia real selecionado, embaralha programas e playlists, preenche descrições vazias, define a âncora e ativa o ciclo de 7 dias na mesma operação atômica. Dias de destino preenchidos bloqueiam a ação para preservar dados. |
| Média | A clonagem avançada chamava um campo numérico de “Hora”, mas esperava segundos entre 0 e 86399. | O campo agora é um seletor `HH:MM`. |
| Média | Excluir um canal deixava programas órfãos no banco. | A exclusão é bloqueada enquanto houver programas vinculados. |
| Baixa | “Recriar Canal Sky” era um atalho fixo, podia tentar duplicar o canal 32 e não fazia parte do editor genérico. | Atalho e código específico removidos. Canais são criados pelo fluxo normal. |

## Funcionalidades que continuam pendentes

| Item | Situação e correção necessária |
|---|---|
| Atualização automática de playlists do YouTube | Ainda não existe. O painel importa uma playlist apenas no momento da edição. Exige uma função protegida no servidor, armazenamento do ID de origem e agendamento diário. |
| RSS automático | A tela importa arquivos RSS, XML ou JSON. Ela não consulta feeds sozinha. Para isso, é necessário um executor agendado. |
| Picture-in-picture | Não está implementado. O player é um iframe do YouTube, portanto a API simples de `<video>` não se aplica diretamente. |
| Analytics e ordenação por popularidade | Não estão implementados. Precisam de agregação com limites para não abrir gravações públicas manipuláveis ou consumir cota sem controle. |
| Publicações automáticas do X | O card atual é editorial e manual. A captura automática depende da API paga do X. |
| Confirmação de exclusões em massa | A exclusão atual informa quantos itens falharam, mas pode concluir parcialmente. Uma evolução recomendada é dividir exclusões em lotes confirmados e registrar os IDs que falharam. |
| Concorrência entre administradores | A grade valida conflitos antes de salvar, porém dois administradores editando simultaneamente ainda podem sobrescrever horários. A numeração de canais já usa transação; a grade completa precisaria de controle de versão. |

## Funções removidas ou reavaliadas

- **Lembrete local de programa:** parecia persistente, mas era apenas um temporizador na aba e continha uso inválido de Hooks. Foi removido.
- **Recriar Canal Sky:** regra específica sem relação com o cadastro geral. Foi removida.
- **Eternity vazio:** ligar repetição sem conteúdo não produz programação. Agora é bloqueado.
- **Preenchimento de sete dias sobre datas ocupadas:** substituir automaticamente conteúdo real seria arriscado. A nova ação só opera quando os seis dias seguintes estão livres.

## Validação

- Build de produção concluído.
- 22 testes automatizados aprovados.
- Cobertura específica para calendário independente do fuso, virada de mês e ano, continuidade após meia-noite e projeção Eternity.
- A conta Firebase real, o YouTube real e a aparência em navegador não foram testados neste ambiente. A validação visual automatizada continua indisponível porque não há Chromium instalado.
