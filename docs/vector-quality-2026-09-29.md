# Auditoria do motor de vetorização — 29/09/2026

Comparação com a versão publicada `1a23feb`. Processamento local, sem serviços externos ou novas dependências de produção.

## Causas reproduzidas e correções

- **Cores intencionais eram eliminadas.** A poda confundia uma área cinza com antialiasing entre preto e branco. Cores discretas agora permanecem exatas; regiões com suporte espacial protegem cores reais durante a poda.
- **Tons claros eram convertidos para branco.** O arredondamento de cores era excessivo, inclusive para tintas com tonalidade. O arredondamento foi restringido a valores quase neutros e extremos; cores discretas não passam por ele.
- **Traços sem um núcleo totalmente opaco desapareciam.** A propagação do fundo por BFS invadia pixels de antialiasing. A classificação passa a usar cobertura e tintas presentes na vizinhança.
- **Ampliação criava contornos extras.** Os lóbulos negativos de Lanczos e a reclassificação das novas cores geravam franjas. A ampliação para vetorização usa interpolação sem esses lóbulos e preserva a classificação espacial da fonte.
- **Alfa era binarizado antes do traçado.** Agora a cobertura da borda é mantida até a extração dos contornos. Valores RGB ligeiramente diferentes na borda semitransparente não criam novas tintas.
- **Pontuação de um pixel era descartada.** O limite fixo de área foi reduzido para respeitar a configuração de detalhe mínimo.
- **Remover fundo podia apagar a arte maior.** O caminho de duas tintas identifica o fundo pela borda, não simplesmente pela cor de maior área.
- **Cantos podiam ganhar pontas artificiais.** A correção de cantos foi limitada pela tolerância geométrica. A reparametrização de Béziers não pode inverter a ordem dos pontos.
- **Diagonais podiam unir ilhas separadas.** O caso ambíguo do marching squares usa a sela bilinear em vez da média dos quatro cantos.
- **Curvas de letras pequenas eram suavizadas demais.** O ajuste de duas tintas usa menor tolerância; a suavização não força um mínimo maior que o detalhe.

## Referência conhecida, ampliação de 4×

As oito artes de referência são SVGs sintéticos em `test/fixtures/vector-quality.js`. O motor recebe apenas o raster de 128×128; a saída e o SVG de referência são renderizados a 512×512. No caso JPEG, a entrada é comprimida com qualidade 72. Os parâmetros são idênticos antes/depois.

O erro abaixo é a diferença média normalizada nos pixels de borda. O detector considera vizinhos horizontais e verticais e compara RGB pré-multiplicado por alfa. Menor é melhor. Esta métrica não representa uma porcentagem universal de qualidade.

| Caso | Erro anterior | Erro corrigido |
| --- | ---: | ---: |
| Cinza intencional | 0,08127 | 0,03889 |
| Branco e marfim | 0,07494 | 0,03305 |
| Pontos e linhas pequenas | 0,19164 | 0,03711 |
| Curvas transparentes | 0,14952 | 0,04953 |
| Curvas opacas | 0,08072 | 0,03317 |
| Curvas multicoloridas | 0,07002 | 0,05963 |
| Texto pequeno | 0,14530 | 0,05682 |
| Texto comprimido em JPEG | 0,07428 | 0,05014 |

Na imagem real fornecida pelo usuário, com o preset Alta fidelidade, o erro de borda medido pelos dois eixos caiu de 0,02378 para 0,02036 (14,4%). O erro global caiu de 0,001741 para 0,001511 (13,2%). A imagem não faz parte do repositório. O número de nós subiu de 1.426 para 4.239: maior fidelidade implica um arquivo mais detalhado neste caso. O indicador antigo, que examinava apenas a borda à esquerda, apontou cerca de 18%; o relatório utiliza a medição em ambos os eixos.

No anel transparente sintético, os nós caíram de 225 para 23 enquanto o erro diminuiu: a cobertura contínua evita traçar a serrilha do alfa binarizado.

## Verificação e reprodução

```powershell
npm test
node scripts/benchmark-quality.js
node scripts/compare-vector.js "caminho/arte.jpeg" 1a23feb artifacts/vector-quality
```

O comparador usa código do histórico Git local e grava os resultados em uma pasta ignorada pelo Git. Não envia a arte para terceiros. Um recorte opcional pode ser passado como quinto argumento: `"x,y,largura,altura"`.

Um ensaio local com 8 milhões de pixels e quatro regiões chapadas consumiu aproximadamente 293 MiB no pico do processo. Isso não é o pior caso: arte com textura e muitas cores consome mais. Permanecem o limite de 8 MP, um worker ativo, cancelamento, limite de complexidade e timeout já existentes.

## Limites desta conclusão

Os testes demonstram ganhos sobre a versão anterior da SublimaIa. Não houve comparação quantitativa com arquivos vetoriais exportados pelo Vectorizer.ai; não há evidência para afirmar superioridade geral sobre ele. Fotos, degradês, transparência de preenchimento e reconstrução semântica de fontes continuam fora da garantia de fidelidade desta bateria de logos e contornos sólidos. Sem informação suficiente no raster, mais nós não recuperam automaticamente o desenho original.
