/**
 * Nomes FICTÍCIOS de propriedades, usados apenas para ilustrar a
 * comunicação tradicional (listagem individual). Não vêm de arquivo real.
 */

/** As seis primeiras propriedades seguem o exemplo do roteiro. */
export const FIRST_PROPERTIES = [
  { type: 'Fazenda', name: 'Boa Esperança' },
  { type: 'Fazenda', name: 'São José' },
  { type: 'Fazenda', name: 'Água Limpa' },
  { type: 'Sítio', name: 'Santa Rita' },
  { type: 'Sítio', name: 'do João' },
  { type: 'Sítio', name: 'Nossa Senhora' },
];

const NAMES = [
  'Santa Clara', 'Bela Vista', 'Três Irmãos', 'Primavera', 'São Bento', 'Recanto Verde',
  'Ouro Branco', 'Bom Retiro', 'Santa Luzia', 'Paraíso', 'Estrela do Sul', 'Alvorada',
  'Rio Claro', 'Monte Alegre', 'Sossego', 'Boa Sorte', 'Santa Fé', 'Vale Verde',
  'São Francisco', 'Canaã', 'Jatobá', 'Ipê Amarelo', 'Aroeira', 'Serrinha', 'Cambará',
  'Santo Expedito', 'Dois Córregos', 'Lagoa Seca', 'Santa Helena', 'Mangueiral',
  'Água Doce', 'Morro Alto', 'Pedra Branca', 'Vista Alegre', 'Esperança', 'Brejão',
  'Ponte Alta', 'Capim Branco', 'Taboca', 'Guarita', 'Mutum', 'Seriema', 'Bom Sucesso',
  'Floresta', 'Querência', 'Tapera', 'Coqueiral', 'Cascata', 'Saudade', 'Santa Marta',
  'Boa Fé', 'Gameleira', 'Sucupira', 'Buritizal', 'Pedra Lisa', 'Novo Horizonte',
  'Santa Maria', 'Palmeiras', 'São Miguel', 'Cachoeira', 'Rio Bonito', 'Paineira',
  'Laranjal', 'Pindorama', 'Vereda', 'Boqueirão', 'Arapuá', 'Soledade', 'Malhada',
  'Pontal', 'Santa Inês', 'Bonança', 'Retiro Feliz', 'Lagoa Dourada', 'Três Marias',
  'Bacuri', 'Imbaúba', 'Rio Preto', 'Tucano', 'Araras', 'Capivara', 'Cedro', 'Baliza',
  'Jacarandá', 'Angico', 'Pequi', 'Mangabeira', 'Barro Preto', 'Olho d’Água',
  'Ribeirão Claro', 'Santa Tereza', 'Poço Fundo', 'Campina Verde', 'Bom Destino',
];

/** Tipo distribuído de forma fixa (sem aleatoriedade) para manter consistência. */
const TYPE_PATTERN = ['Fazenda', 'Sítio', 'Fazenda', 'Chácara', 'Fazenda', 'Sítio', 'Fazenda', 'Estância'];

export const PROPERTY_NAMES = NAMES.map((name, i) => ({ type: TYPE_PATTERN[i % TYPE_PATTERN.length], name }));
