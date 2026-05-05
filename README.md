# Sage

Plataforma de cursos escalável com trilhas estruturadas em Ciência de Dados, Python, SQL, UI e UX — com player de vídeo customizado, autenticação JWT e banco de dados relacional.

**Demo:** [sage.numera.com.br](https://sage.numera.com.br)

## Trilhas disponíveis

- Ciência de Dados
- Python
- SQL
- UI (Interface de Usuário)
- UX (Experiência do Usuário)

## Funcionalidades

- Catálogo de cursos configurável via `data.json` — sem necessidade de alterar código
- Player de vídeo com controles customizados: play/pause, salto de 10s, seek e velocidade
- Controle de legendas via YouTube IFrame API
- Autenticação com JWT e hash de senhas com bcrypt
- Cadastro com confirmação por e-mail
- Drawer lateral com glassmorphism para navegação mobile
- Design responsivo e mobile-first

## Stack

- **Frontend:** HTML5 + CSS3 + JavaScript puro
- **Backend:** Node.js (compatível com Cloudflare Workers/Pages)
- **Banco de dados:** Neon PostgreSQL
- **Auth:** JWT + bcrypt
- **Vídeo:** YouTube IFrame Player API

## Estrutura de páginas

| Página | Descrição | Acesso |
|--------|-----------|--------|
| `index.html` | Dashboard e catálogo de cursos | Autenticado |
| `player.html` | Player de vídeo | Autenticado |
| `login.html` | Autenticação | Público |
| `register.html` | Cadastro | Público |
| `confirm.html` | Confirmação de e-mail | Público |

## Como rodar

```bash
git clone https://github.com/seu-usuario/sage.git
cd sage

# Instale dependências do backend
npm install

# Configure as variáveis de ambiente
# DATABASE_URL, JWT_SECRET e credenciais SMTP

# Sirva o frontend
npx serve .
```

## SEO

Inclui `sitemap.xml`. Submeta no [Google Search Console](https://search.google.com/search-console) após publicar. Atualize o domínio no arquivo antes do deploy.

## Licença

MIT
