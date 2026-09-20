# Variações órfãs — mapa e plano de limpeza

Snapshot da investigação feita em 2026-09-20, sobre os ~55 produtos com variações
duplicadas causadas pelo bug de "Aplicar a todos" / save-antes-de-carregar do
`ProductForm.jsx` (já corrigido em produção — ver commit `8ef1ad7` no `adoratta-app`).
A correção parou a criação de novas órfãs; este documento é sobre limpar as que já
existem no catálogo.

**Status: pausado, nada apagado ainda.** Dados completos em [`orfas-mapa.json`](./orfas-mapa.json)
(194 linhas). Este arquivo é o plano — leia antes de continuar numa sessão futura.

## Metodologia

- Chave de atributo = mesma lógica do `varKey` do app: atributos ordenados por nome,
  formato `"Nome:Opção|Nome:Opção"`.
- Dentro de cada chave com 2+ variações, a API do WooCommerce devolve em ordem
  **decrescente de ID** (confirmado empiricamente) — o `forEach` que popula
  `variationOverrides` no app faz a última ocorrência vencer, ou seja, **a de menor ID
  é a que o app reconhece e atualiza** ("fica"). As demais da mesma chave são órfãs
  ("saem" — candidatas a exclusão).
- Pra cada par fica/órfã: comparei estoque, `ecomus_variation_images` (galeria), foto
  principal (`image`), e — pros 25 produtos com `status: publish` — o `data-product_variations`
  real da página pública da loja, pra ver qual variação o WooCommerce está de fato
  expondo pro cliente hoje.

## Achado central: a órfã pode ser quem vende de verdade

O WooCommerce esconde do storefront, por padrão, variações com estoque zerado. Em
muitos pares, a variação "fica" (a que o app reconhece) está com estoque 0 e a
"órfã" tem estoque real — nesses casos, **a loja mostra e vende a partir da órfã**,
não da que o app gerencia. Confirmado lendo o HTML público de cada produto publicado:
35 casos confirmados diretamente (mais os produtos em `draft`, que têm o mesmo risco
latente se forem publicados sem antes resolver isso).

**Isso significa que a regra ingênua "sempre apaga a de ID maior" é insegura** para
uma parte real do catálogo — apagaria a única variação comprável daquela cor/tamanho.

## Achado adicional: o "bug da foto" na loja é o MESMO problema

Investigação do plugin `fk-variacao-estoque` (da FK, usado pela Adoratta) explica um
sintoma relatado à parte — a variação abre numa cor (ex: Azul) mas mostra a foto de
outra cor:

- O plugin troca automaticamente a variação pré-selecionada pela primeira **com
  estoque**, quando a padrão está esgotada. Comportamento correto e intencional — não
  é bug do plugin nem do tema.
- Como a variação "fica" (a que o app edita) está com estoque zero e o estoque real
  está na órfã duplicada, o plugin enxerga a cor padrão como esgotada e pula pra outra
  cor que tem estoque de verdade — daí a foto trocar sozinha ao carregar a página.
- Clicar manualmente na cor força a variação órfã (a que tem estoque) e "conserta" na
  hora — o que mascarava a causa real até agora.

**Conclusão: o bug da foto e a limpeza das órfãs são o mesmo trabalho.** Resolver a
duplicação (garantir 1 variação por cor, com o estoque certo) faz o plugin voltar a
funcionar normalmente e a foto parar de pular sozinha. **Não mexer no
`fk-variacao-estoque`** — ele está correto; o dado por trás dele é que está bagunçado
pelas órfãs.

## Números

| | |
|---|---|
| Produtos com duplicatas reais | 53 |
| Pares fica/órfã mapeados | 194 |
| Órfãs com estoque > 0 (Grupo A) | 52, em 24 produtos |
| Órfãs sem estoque (Grupo B) | 142, em 37 produtos |
| Confirmado: loja mostra a órfã hoje | 35 (subconjunto do Grupo A, só produtos publicados) |
| Órfãs com galeria Ecomus que a "boa" não tem | 0 |
| Órfãs com foto principal diferente da "boa" | 92 (baixa prioridade — é só a foto de capa, não estoque) |

## Plano em 2 grupos

### Grupo A — 52 pares, 24 produtos — NÃO apagar direto

A órfã tem estoque > 0. Antes de excluir qualquer uma dessas, decidir por par:

1. **Confirmar com a cliente o estoque real** de cada cor/tamanho afetado (a API não
   basta aqui — pode haver venda em andamento, estoque físico não bate com o sistema,
   etc.).
2. Pra cada par, escolher uma estratégia:
   - **Migrar o estoque** da órfã pra a variação "fica" (update de `stock_quantity`)
     e só então apagar a órfã — mantém o ID que o app já reconhece.
   - **Inverter qual sobrevive**: manter a órfã (que já tem estoque e é o que a loja
     mostra) e apagar a "fica" zerada — evita mexer em estoque, mas o app "esquece"
     esse ID até o próximo save recarregar do zero (deve funcionar normal, já que o
     app sempre lê a lista atual de variações).
3. Só depois de decidido e confirmado, executar a exclusão — em lotes pequenos, com
   aprovação explícita antes de cada lote (não é uma operação reversível).

A lista completa dos 52 pares, com produto/chave/ids/estoques, está em
[`orfas-mapa.json`](./orfas-mapa.json) (campo `flagStock: true`) e no artifact publicado
durante a investigação (link na conversa da sessão de 2026-09-20 — pode não estar mais
acessível numa sessão futura; o JSON aqui é a fonte de verdade permanente).

### Grupo B — 142 pares, 37 produtos — mais simples, mas ainda não apagar sem aprovação

A órfã não tem estoque (`stock_quantity` 0 ou `manage_stock: false`) — apagar aqui não
perde estoque real. Mesmo assim:

- Confirmar que nenhuma dessas é usada em algum pedido em andamento (histórico de
  pedidos referencia `variation_id` — um pedido antigo continua funcionando mesmo se a
  variação for apagada, mas vale checar antes de um lote grande).
- Fazer em lotes, com aprovação antes de cada lote, mesmo sendo o caminho "seguro" —
  é uma operação destrutiva e irreversível de qualquer forma.

### Fora de escopo — 2 produtos (não são duplicata)

**Saia Fernanda (3214)** e **Calça Iara (6590)**: o produto hoje só lista Tamanho
P/M/G nos atributos, mas existem variações de um tamanho **GG** que foi removido da
lista — cada uma é única (nenhuma compartilha chave com outra), não há par fica/órfã.
É uma decisão diferente (remover ou não um tamanho descontinuado do catálogo), fora do
critério "duplicata" usado aqui. Variações órfãs desse tipo:

- 3214 — Saia Fernanda: variação 3215 (GG), sem par
- 6590 — Calça Iara: variações 6813, 6817, 6821, 6825 (GG × 4 cores), sem par

## Próximos passos (quando retomar)

1. Rever este documento e o `orfas-mapa.json` já com o histórico da sessão original
   fora de contexto — não redescobrir do zero, os dados aqui são a fonte de verdade.
2. Levar o Grupo A pra cliente confirmar estoque real, par a par.
3. Definir e aprovar o lote 1 (sugestão: começar pelo Grupo B, menor risco).
4. Cada exclusão real precisa de aprovação explícita antes de rodar — nunca em lote
   automático sem revisão.
