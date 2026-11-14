# JWB • Sistema Corporativo

## Requisitos

- Node.js 22.5 ou superior (backend com SQLite integrado).
- npm.
- Python 3.10 ou superior e as dependências de `requirements.txt`.

## Inicialização local

Na pasta do projeto, execute:

```bash
python3 -m pip install -r requirements.txt
npm install
python3 -m unittest discover -s tests -v
npm test
npm run dev
```

Abra `http://localhost:5173`. O comando de desenvolvimento inicia também a API em `http://localhost:3001`; o Vite encaminha as chamadas `/api` para ela. A compilação de produção do front-end é criada com `npm run build`; `npm run preview` serve essa compilação. `npm start` inicia só a API.

## Conta demonstrativa

- CEO: `ceo@demo.com`
- Senha inicial: `trocar-esta-senha`

Os demais usuários demonstrativos são `carlos@demo.com`, `fernanda@demo.com` e `lucas@demo.com`, todos com a mesma senha inicial. Troque as senhas antes de qualquer uso real; a senha inicial destina-se apenas ao ambiente local de demonstração.

## Funcionalidades e limites

- Login, setores e trilha de auditoria usam a API e banco SQLite local (`jwb.db`). O projeto é um protótipo e não está validado para dados reais ou produção.
- Cada arquivo auditado registra metadados e hash SHA-256 em eventos encadeados.
- Importa XLSX, CSV, TSV e TXT (converta XLS e ODS para XLSX); PDFs com camada de texto também são lidos pelo processador Python. O limite é 2 MB por arquivo. PDF digitalizado como imagem exige OCR, que não está incluído.
- Não existe cotação de mercado integrada. A análise pode identificar números indevidos ou duplicar totais, exigindo conferência humana.
- A revisão com IA é opcional e **sugestiva**: exige `OPENAI_API_KEY` no servidor; nunca aplica alterações sem confirmação humana. O texto enviado é transmitido ao provedor de IA configurado.
- A tela Ferramentas permite verificar a cadeia de hashes e exportar a trilha como CSV.
- Hash encadeado torna alterações detectáveis se a cadeia original estiver preservada; não é armazenamento WORM e um administrador com acesso ao SQLite pode reconstruí-la. Faça backups externos imutáveis.
- Antes de produção são necessários testes, auditoria de segurança independente, HTTPS, política de acesso, backups externos testados e correção das vulnerabilidades restantes. Configure `TOKEN_SECRET` persistente, `CEO_INITIAL_PASSWORD` e `DEMO=0`. Não utilize dados ou senhas de demonstração em produção.

## Deploy com Docker

```bash
cp .env.example .env
# edite .env: defina TOKEN_SECRET (32+ caracteres) e CEO_INITIAL_PASSWORD (12+ caracteres)
docker compose up --build -d
```

Abra `http://localhost:3001`. O SQLite fica no volume persistente `jwb-data`. Para usar o modo IA, acrescente `OPENAI_API_KEY` ao `.env`. PDFs de imagem ainda precisam de OCR. O mesmo container pode ser implantado em Railway, Render, Fly.io ou outro host Docker **desde que tenha volume persistente** montado em `/data`; SQLite em disco efêmero perde os dados ao reiniciar ou substituir a instância. Para alta disponibilidade e múltiplas instâncias, migre para PostgreSQL antes do deploy.

## Node + Python

O servidor Node autentica usuários, controla acesso e recebe o arquivo; o processo Python extrai texto de PDF e planilhas, calcula SHA-256 e não executa instruções dos documentos. A análise de valores é heurística e sujeita a erros. Arquivos digitalizados precisam de OCR, não incluído. A integração não substitui uma revisão de segurança, adequação à LGPD, controle de acesso completo, backups testados e validação com a empresa.

O repositório contém instruções de implantação mas não é uma solução homologada de produção. O deploy e a IA exigem configuração e testes específicos da conta.
