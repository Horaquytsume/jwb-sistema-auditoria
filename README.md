# JWB • Sistema Corporativo

## Requisitos

- Node.js 22.5 ou superior (backend com SQLite integrado).
- npm.

## Inicialização local

Na pasta do projeto, execute:

```bash
npm install
npm test
npm run dev
```

Abra `http://localhost:5173`. O comando de desenvolvimento inicia também a API em `http://localhost:3001`; o Vite encaminha as chamadas `/api` para ela. A compilação de produção do front-end é criada com `npm run build`; `npm run preview` serve essa compilação. `npm start` inicia só a API.

## Conta demonstrativa

- CEO: `ceo@demo.com`
- Senha inicial: `trocar-esta-senha`

Os demais usuários demonstrativos são `carlos@demo.com`, `fernanda@demo.com` e `lucas@demo.com`, todos com a mesma senha inicial. Troque as senhas antes de qualquer uso real; a senha inicial destina-se apenas ao ambiente local de demonstração.

## Funcionalidades e limites

- Login, setores e trilha de auditoria usam a API e banco SQLite local (`jwb.db`).
- Cada arquivo auditado registra metadados e hash SHA-256 em eventos encadeados.
- Importa XLSX, XLS, ODS, CSV, TSV e TXT; PDFs com camada de texto também são lidos. PDF digitalizado como imagem exige OCR, que não está incluído.
- A referência de preços é demonstrativa, não é uma cotação em tempo real.
- Para produção, configure `TOKEN_SECRET` persistente, restrinja `CORS_ORIGIN`, altere as senhas de demonstração e configure armazenamento e cópias de segurança do banco.
