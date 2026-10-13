# Atualização v8 — visualização em modo Estúdio

- A TV inicia por padrão no layout Estúdio, com o player menor à esquerda e uma área lateral com canal, atração atual, descrição e próxima atração.
- Canais com pacote de notícias habilitado usam a coluna social/manchetes e a arte editorial já configuradas; a faixa de GC e ticker permanecem no layout.
- Em Configurações, é possível escolher Estúdio ou Player ampliado como modo padrão.
- Alternância automática opcional a cada 5, 10, 15, 20, 30 ou 60 minutos troca entre o Estúdio e o Player ampliado.
- A tela cheia nativa do navegador segue manual pelo botão ⛶ ou atalho F. Ao acioná-la no Estúdio, o player passa para o layout ampliado.
- Preferências são salvas no navegador e a reprodução continua usando a sincronização de horário existente.

## Validação

- `npm test`: aprovado (3 arquivos de teste, 28 verificações).
- `npm run build`: aprovado. Permanece o aviso pré-existente do bundle inicial acima de 500 kB.
- Não foi realizado teste visual em aparelho físico nem implantado no site publicado.
