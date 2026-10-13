# Atualização v9 — controles durante a live e recuperação de atraso

- O menu OSD agora tem um botão para alternar imediatamente entre Estúdio e Player normal/ampliado, além da configuração do modo padrão.
- O botão **Reduzir atraso** habilita recuperação automática: o player consulta as velocidades aceitas pelo vídeo, usa 2× enquanto estiver mais de quatro segundos atrás da grade e volta a 1× ao alcançá-la.
- Se 2× não estiver disponível, a interface avisa e mantém o sincronismo existente, sem repetir saltos de posição continuamente.
- A preferência fica salva no navegador; ao desativá-la, o player retorna imediatamente para 1×.
- A função atua depois que a reprodução inicia. Ela não diminui o tempo inicial de carregamento da rede, e a disponibilidade de 2× depende do vídeo/YouTube.

## Validação

- `npm test`: aprovado (3 arquivos de teste).
- `npm run build`: aprovado. Persiste o aviso do bundle inicial acima de 500 kB.
- A chamada real ao YouTube e a disponibilidade de 2× em uma transmissão específica precisam ser verificadas no site/dispositivo; não foram simuladas no build.
