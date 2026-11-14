export const SECTORS = [
  { id: 'operacoes', name: 'Operações & Frota', manager: 'Carlos Mendes', description: 'Logística e manutenção leve', budget: 85000, baseSpent: 79000, efficiency: 78, periodStart: null },
  { id: 'manutencao', name: 'Manutenção Pesada', manager: 'Carlos Mendes', description: 'Oficina interna e corretivas', budget: 45000, baseSpent: 48500, efficiency: 64, periodStart: null },
  { id: 'comercial', name: 'Comercial & Locação', manager: 'Fernanda Costa', description: 'Vendas e atendimento RAC', budget: 60000, baseSpent: 51200, efficiency: 94, periodStart: null },
  { id: 'financeiro', name: 'Financeiro & Admin', manager: 'Roberto Alves', description: 'Contas a pagar e controladoria', budget: 35000, baseSpent: 33800, efficiency: 91, periodStart: null }
];

export const EMPLOYEES = [
  { id: 'emp-1', name: 'Lucas Ferreira', role: 'Assistente', sectorId: 'operacoes', sector: 'Operações & Frota', baseScore: 94, onTimeRate: 98, baseTasks: 141, status: 'Alta Performance • Reporta falhas com precisão', statusColor: 'emerald' },
  { id: 'emp-2', name: 'Carlos Mendes', role: 'Gerente', sectorId: 'operacoes', sector: 'Operações & Frota', baseScore: 77, onTimeRate: 74, baseTasks: 57, status: 'Alerta de Omissão • Edições em registros de custo', statusColor: 'red' },
  { id: 'emp-3', name: 'Mariana Santos', role: 'Assistente', sectorId: 'manutencao', sector: 'Manutenção Pesada', baseScore: 88, onTimeRate: 92, baseTasks: 118, status: 'Sobrecarga detectada • Cobrindo atrasos do setor', statusColor: 'amber' },
  { id: 'emp-4', name: 'Fernanda Costa', role: 'Gerente', sectorId: 'comercial', sector: 'Comercial & Locação', baseScore: 91, onTimeRate: 96, baseTasks: 94, status: 'Meta batida • Registros 100% transparentes', statusColor: 'emerald' }
];

export const USERS = [
  { id: 'u-ceo', name: 'Diretoria / CEO', email: 'ceo@demo.com', role: 'ceo', sectors: ['operacoes', 'manutencao', 'comercial', 'financeiro'] },
  { id: 'u-carlos', name: 'Carlos Mendes (Gerente)', email: 'carlos@demo.com', role: 'manager', sectors: ['operacoes', 'manutencao'] },
  { id: 'u-fernanda', name: 'Fernanda Costa (Gerente)', email: 'fernanda@demo.com', role: 'manager', sectors: ['comercial'] },
  { id: 'u-lucas', name: 'Lucas Ferreira (Assistente)', email: 'lucas@demo.com', role: 'assistant', sectors: ['operacoes'] }
];

export const RBAC = {
  manager: { viewFinancialDeficit: true, viewEmployeeScores: true, viewOtherSectors: false, canEditOrHideLogs: true, receiveAiSummary: false },
  assistant: { viewFinancialDeficit: false, viewEmployeeScores: false, viewOtherSectors: false, canEditOrHideLogs: false, receiveAiSummary: false }
};

export const EVENTS = [
  { log: 'LOG-904', h: 2, kind: 'created', actor: 'Lucas Ferreira (Assistente)', data: { author: 'Lucas Ferreira (Assistente)', authorRole: 'assistant', sectorId: 'operacoes', type: 'prejuizo', typeLabel: 'Gasto Extra / Prejuízo', impact: 9800, text: 'Veículo placa FBC-4920 fundiu o motor por falta de troca de óleo no prazo. Orçamento da retífica: R$ 9.800.' } },
  { log: 'LOG-904', h: 1, kind: 'edited', actor: 'Carlos Mendes (Gerente)', data: { text: 'Veículo placa FBC-4920 entrou em manutenção preventiva programada de rotina na oficina parceira.', reason: 'Edição manual realizada no mural' } }
];
