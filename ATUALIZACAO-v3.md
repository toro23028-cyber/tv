# Atualizacao v3

- Home, guia rapido e programacao completa consultam hoje e amanha. A janela de consulta cobre as proximas 24 horas, incluindo eternity, com identificacao de Amanha.
- A Home nao limita mais cada canal a cinco programas. O guia tem duas linhas visiveis e rolagem vertical para os demais canais. O canal selecionado aparece primeiro.
- A TV preserva a sincronizacao absoluta e consulta o dia seguinte para a proxima atracao.
- Redacao: contador e validacao de 25 palavras, alem dos 240 caracteres; duracoes estaveis de 10, 15, 20 ou 30 minutos, contadas a partir da publicacao. Republicar renova os itens aprovados.
- Salvamentos sem confirmacao exibem aviso apos 15 segundos. Isso nao cancela uma gravacao pendente no Firebase. Uma falha ao carregar rascunhos impede sobrescrever dados desconhecidos.
- Descricoes genericas tambem sao sugeridas ao editar um programa sem sinopse ou aplicar um padrao vazio. O painel permite preencher descricoes vazias em lote sem substituir textos existentes.
- O aviso de proximo programa respeita a posicao selecionada para o relogio.

## Instalacao e verificacao

Substitua os arquivos do projeto e publique um novo build. Este ZIP nao altera automaticamente o site em producao nem as regras do Firebase.

Se a versao anterior continuar aparecendo no PWA, feche todas as abas e a janela instalada do TREND TV e reabra. O service worker aguarda o fechamento das abas para ativar a atualizacao sem interromper a transmissao.

Validacao local: 21 testes automatizados aprovados e build de producao concluido. Os testes cobrem meia-noite, virada do ano, eternity, posicao de video e duracao editorial. A verificacao visual automatizada nao pode ser concluida porque o navegador Chromium nao esta instalado neste ambiente. Publicacao real no Firebase depende das permissoes e conexao do projeto e nao foi testada nesta revisao.
