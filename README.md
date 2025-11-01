# CP Panel

Painel de partidas de comboios da CP (Comboios de Portugal) usando dados das Infraestruturas de Portugal.

## Tecnologias

- **Next.js 15** (App Router)
- **React 19**
- **TypeScript**

## Características

- ✅ Pesquisa de estações ferroviárias em tempo real
- ✅ Visualização de partidas e chegadas
- ✅ Atualização automática a cada 30 segundos
- ✅ Interface responsiva e escalável
- ✅ Indicadores visuais para comboios atrasados/suprimidos
- ✅ API Routes integradas no Next.js

## Instalação

```bash
npm install
```

## Desenvolvimento

```bash
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000) no navegador.

## Produção

```bash
npm run build
npm start
```

## Estrutura do Projeto

```
├── src/
│   └── app/
│       ├── api/
│       │   ├── board/      # Endpoint para partidas/chegadas
│       │   ├── health/     # Health check
│       │   └── stations/   # Pesquisa de estações
│       ├── globals.css     # Estilos globais
│       ├── layout.tsx      # Layout raiz
│       ├── page.css        # Estilos da página principal
│       └── page.tsx        # Página principal
├── .env.local              # Variáveis de ambiente
├── next.config.ts          # Configuração do Next.js
├── package.json
└── tsconfig.json
```

## Variáveis de Ambiente

Crie um ficheiro `.env.local`:

```
NEXT_PUBLIC_API_URL=
```

Deixe vazio para usar as API routes locais.

## API Endpoints

- `GET /api/health` - Health check
- `GET /api/stations?q={query}` - Pesquisar estações
- `GET /api/board?stationId={id}` - Obter partidas/chegadas de uma estação

## Licença

MIT
