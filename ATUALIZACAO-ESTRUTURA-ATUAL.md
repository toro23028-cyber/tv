# Atualização para a estrutura atual — 12/10/2026

Aplicado sem exigir novo serviço:

- Busca por nome, descrição e etiqueta na programação do Admin; filtro por live, playlist e vinheta. A busca opera sobre o canal e o dia selecionados. Reordenação por arraste fica desativada durante filtragem para preservar os horários dos programas ocultos.
- Pendências do dia: canais sem programação e lives sem canal de origem.
- Exportação JSON de grade, modelos e configurações de canais.
- Restauração com prévia, detecção de IDs repetidos, tamanho máximo de 5 MB, até 450 programas por lote e verificação de conflitos. Restaura programas nos canais já existentes; não cria/exclui canais. Por padrão ignora programas com IDs existentes; atualização desses registros exige marcar a opção no diálogo. Configurações dos canais são preservadas na exportação para referência, mas não são restauradas automaticamente. A Redação não integra este backup.
- Prévia do pacote editorial na Redação com alternância TV/Desktop e Celular. Renderiza o componente real de GC, mensagens e ticker; usa uma área de vídeo representativa.
- Ícones SVG no menu do Admin e controles principais da Home/player (play, favorito, início, som, compartilhar e configurações). Logos personalizados de canais continuam editáveis.

## Verificação

`npm run check`: 46 testes de regras/regressão, 10 verificações de componentes/gravações simuladas, build aprovado. Nenhum banco de produção foi alterado. Sem testes visuais em navegador ou Smart TV nesta sessão. Os mocks são exclusivos dos testes.

Registro: `testes-atualizacao.log`.

## Dependências ainda necessárias

Atualização diária de playlists, histórico editorial persistente, RSS automático e proteção contra edição simultânea precisam de implementação/configuração adicional no servidor. Não estão incluídos como funções operacionais nesta entrega. A descoberta de live existente continua disponível com as variáveis documentadas no LEIA-ME.

## Instalação

Substituir o código no repositório, instalar com `npm ci`, executar `npm run check` e publicar na hospedagem habitual. Esta entrega não foi publicada automaticamente na Vercel. Leia também `LEIA-ME.md` e `RELATORIO-REANALISE.md` para configuração e limites.
