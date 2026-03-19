# 💎 Sage LMS Platform - Modern Learning Experience

Uma plataforma de gerenciamento de cursos (LMS) focada em UX minimalista, alta performance e experiência mobile impecável.

## ✨ Principais Funcionalidades

### 🎞️ Player de Vídeo Avançado
- **Controles Personalizados**: Play/Pause, Salto de 10s (Avançar/Retroceder) e Seek rápido.
- **Legendas (CC)**: Botão dedicado para ativar/desativar legendas via API do YouTube.
- **Feedback Visual**: Interface White-Label que oculta elementos nativos do YouTube para manter o foco na marca.
- **Erro Customizado**: Tratamento visual para vídeos indisponíveis ou privados.

### 📱 Navegação Mobile-First
- **Drawer Moderno**: Menu lateral que desliza suavemente com efeito de desfoque (*Glassmorphism*).
- **Backdrop Inteligente**: Fundo escuro que bloqueia interações externas e permite fechar o menu com um toque.
- **Trava de Rolagem**: Estabilidade total na navegação mobile ao abrir menus.

### 🍱 Arquitetura Escalável
- **JSON Driven**: Todo o catálogo de cursos e módulos é gerenciado através de um único arquivo `data.json`.
- **Vanilla Tech**: Desenvolvido 100% com HTML, CSS e JS puros, garantindo carregamento instantâneo e facilidade de manutenção.

## 🚀 Tecnologias Utilizadas

- **HTML5**: Estrutura semântica e SEO-friendly.
- **CSS3 Moderno**: Variáveis (Custom Properties), Flexbox, Grid e Transições fluídas.
- **JavaScript (ES6+)**: Manipulação de DOM reativa e integração com APIs externas.
- **YouTube IFrame Player API**: Controle programático do player de vídeo.

## 🛠️ Como Iniciar

A plataforma é estática e não requer compilação. Para rodar localmente:

1. Clone o repositório ou baixe os arquivos.
2. Servir a pasta raiz via servidor local (ex: Live Server do VS Code ou `python -m http.server`).
3. Abra `index.html` no navegador.

## 📂 Estrutura de Pastas

- `/`: Arquivos raiz (`index.html`, `player.html`).
- `style.css`: Design System completo e responsividade.
- `app.js`: Lógica de navegação, player e manipulação de dados.
- `data.json`: Banco de dados de cursos, módulos e aulas.

## 📝 Licença

Este projeto é disponibilizado sob a licença MIT. Sinta-se à vontade para expandir e personalizar!

---
Desenvolvido com foco em excelência técnica e visual. 💎🏆
