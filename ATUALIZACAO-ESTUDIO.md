# Atualização do estúdio e das lives

O print mostrava uma lacuna da grade (“Voltamos já!”), não um erro reportado pelo player do YouTube. A URL de uma live em um programa só é reproduzida dentro do horário agendado. Foi adicionada uma fonte padrão explícita para cobrir os intervalos sem programa.

## Aplicar

1. Publique os arquivos desta versão, preservando as variáveis existentes.
2. Admin → Redação → selecione o canal → Live padrão do canal → cole a URL do vídeo/live do YouTube.
3. Opcionalmente informe @handle/ID UC para procurar as próximas lives. A busca automática continua dependendo das configurações e permissões do servidor descritas em ATUALIZACAO-NOTICIAS-LIVES.md.
4. Escolha a cor do GC em “Exibição na TV”; também é possível escolher uma cor personalizada.
5. Clique em “Publicar na TV”. Salvar rascunho preserva os campos para revisão, mas não altera a transmissão.

A fonte padrão aparece na Home e no guia, cobre somente lacunas e não substitui playlists ou lives agendadas. Apagar a URL e publicar desativa a fonte padrão. Modelos continuam fora da grade. Lives de longa duração não recebem mais títulos e divisões de maratona. Links antigos salvos em youtubeId/videos também são aceitos na reprodução de programas marcados como live.

## Pacote gráfico

O desenho estático antigo e os textos estavam sendo empilhados. O estúdio usa agora um único conjunto de painéis responsivos, com GC claro, faixa colorida, fonte, manchete e subtítulo separados e mensagens à direita. O relógio de Brasília e a indicação de live ficam dentro do GC, mesmo que a opção de relógio flutuante esteja desligada. O relógio flutuante continua disponível no modo normal. Itens urgentes mantêm destaque vermelho.

Os controles OSD ocultam temporariamente o pacote editorial quando abertos, evitando a colisão entre controles, ticker e GC. Ao se ocultarem, o pacote retorna. Textos extensos possuem limites de linhas e quebra de palavras; zoom do GC não desloca os painéis do estúdio. A prévia usa o mesmo componente e a mesma cor publicada.

## Validação

58 testes de regras e regressão, 14 verificações de renderização/gravação simulada e build de produção passaram. Novos casos verificam lacunas hoje/amanhã, prioridade da grade, URLs inválidas, lives sem maratona, cores válidas, relógio integrado, GC desligado e mensagem social sem duplicação.

Não houve publicação na Vercel, alteração de dados reais nem teste de reprodução autenticado no navegador nesta entrega. Portanto a reprodução efetiva da live e a aparência em dispositivos físicos precisam ser verificadas depois do deploy. Vídeos restritos, privados ou sem permissão de incorporação continuam sujeitos às regras do YouTube.
