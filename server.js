const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Servir arquivos estáticos (Frontend)
app.use(express.static('.'));

// Logger de requisições
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
    console.error('ERRO INESPERADO NO POOL PG:', err);
});

pool.query('SELECT NOW()', (err, result) => {
    if (err) {
        console.error('Erro ao conectar ao Neon.tech:', err);
    } else {
        console.log('Conectado ao Neon.tech com sucesso em:', result.rows[0].now);
    }
});

// Rota de saúde
app.get('/api/health', (req, res) => res.json({ status: 'ok', message: 'Servidor Sage está vivo!' }));

// --- MIDDLEWARES DE SEGURANÇA ---

const JWT_SECRET = process.env.JWT_SECRET || 'sage-fallback-secret';
const BCRYPT_ROUNDS = 10;

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token não fornecido' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token inválido ou expirado' });
        }
        req.user = user;
        next();
    });
}

function requireAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Acesso negado: Requer permissão de Administrador' });
    }
}

// --- API ROUTES ---

// 1. Catálogo slim (sem IDs de vídeo)
app.get('/api/catalog', authenticateToken, async (req, res) => {
    try {
        const [catsResult, coursesResult] = await Promise.all([
            pool.query('SELECT id, name, slug FROM public.categories ORDER BY name ASC'),
            pool.query(`
                SELECT
                    c.id as db_id, c.category_id, c.title, c.slug, c.banner_url as banner,
                    (SELECT count(*) FROM public.episodes ep JOIN public.modules m ON ep.module_id = m.id WHERE m.course_id = c.id) as episode_count
                FROM public.courses c
            `)
        ]);

        const categories = catsResult.rows.map(cat => ({
            ...cat,
            courses: coursesResult.rows
                .filter(course => course.category_id === cat.id)
                .map(course => ({
                    id: course.slug,
                    title: course.title,
                    banner: course.banner,
                    episode_count: parseInt(course.episode_count) || 0
                }))
        }));

        res.json({ categories });
    } catch (err) {
        console.error('ERRO CRÍTICO NO CATÁLOGO:', err);
        res.status(500).json({ error: 'Falha ao processar catálogo no servidor' });
    }
});

// 2. Detalhes completos do curso (SEM IDs de vídeo — protegido)
app.get('/api/course/:slug', authenticateToken, async (req, res) => {
    const { slug } = req.params;
    try {
        const query = `
            WITH course_info AS (
                SELECT id, title, slug, description, banner_url as banner
                FROM public.courses
                WHERE slug = $1
            ),
            module_episodes AS (
                SELECT
                    m.id as mod_id,
                    m.title as mod_title,
                    m."order" as mod_order,
                    json_agg(json_build_object(
                        'id', e.id,
                        'title', e.title,
                        'description', e.description,
                        'duration', e.duration,
                        'banner', e.banner_url
                    ) ORDER BY e."order") as episodes
                FROM public.modules m
                LEFT JOIN public.episodes e ON e.module_id = m.id
                WHERE m.course_id = (SELECT id FROM course_info)
                GROUP BY m.id, m.title, m."order"
            )
            SELECT
                c.*,
                COALESCE(json_agg(me.* ORDER BY me.mod_order) FILTER (WHERE me.mod_id IS NOT NULL), '[]'::json) as modules
            FROM course_info c
            LEFT JOIN module_episodes me ON true
            GROUP BY c.id, c.title, c.slug, c.description, c.banner;
        `;
        const result = await pool.query(query, [slug]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Curso não encontrado' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Erro ao buscar curso:', err);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// 3. Referência de reprodução (autenticado — isola a fonte do vídeo)
app.get('/api/play/:episodeId', authenticateToken, async (req, res) => {
    const { episodeId } = req.params;
    try {
        const result = await pool.query(
            'SELECT video_url FROM public.episodes WHERE id = $1',
            [episodeId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Conteúdo não encontrado' });
        }
        // Retorna apenas a referência necessária para o player, sem expor a origem
        res.json({ ref: result.rows[0].video_url });
    } catch (err) {
        console.error('Erro ao buscar conteúdo:', err);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// 4. Admin: Criar curso com episódios (transação completa)
app.post('/api/admin/course', authenticateToken, requireAdmin, async (req, res) => {
    const { courseName, categoryName, moduleName, episodes } = req.body;

    if (!courseName?.trim() || !categoryName?.trim() || !episodes?.length) {
        return res.status(400).json({ error: 'Nome do curso, categoria e ao menos um episódio são obrigatórios.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Encontrar ou criar categoria
        const catSlug = slugify(categoryName);
        let catResult = await client.query(
            'SELECT id FROM public.categories WHERE slug = $1', [catSlug]
        );
        let categoryId;
        if (catResult.rows.length > 0) {
            categoryId = catResult.rows[0].id;
        } else {
            const newCat = await client.query(
                'INSERT INTO public.categories (name, slug) VALUES ($1, $2) RETURNING id',
                [categoryName.trim(), catSlug]
            );
            categoryId = newCat.rows[0].id;
        }

        // Criar curso
        const courseSlug = slugify(courseName) + '-' + Date.now();
        const courseResult = await client.query(
            'INSERT INTO public.courses (category_id, title, slug) VALUES ($1, $2, $3) RETURNING id',
            [categoryId, courseName.trim(), courseSlug]
        );
        const courseId = courseResult.rows[0].id;

        // Criar módulo padrão
        const modTitle = moduleName?.trim() || 'Aulas';
        const modResult = await client.query(
            'INSERT INTO public.modules (course_id, title, "order") VALUES ($1, $2, $3) RETURNING id',
            [courseId, modTitle, 1]
        );
        const moduleId = modResult.rows[0].id;

        // Criar episódios
        for (let i = 0; i < episodes.length; i++) {
            const { title, url } = episodes[i];
            if (!title?.trim() || !url?.trim()) continue;
            const videoRef = extractVideoRef(url);
            await client.query(
                'INSERT INTO public.episodes (module_id, title, video_url, "order") VALUES ($1, $2, $3, $4)',
                [moduleId, title.trim(), videoRef, i + 1]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, courseSlug });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Erro ao criar curso:', err);
        if (err.code === '23505') {
            res.status(409).json({ error: 'Já existe um curso com este nome.' });
        } else {
            res.status(500).json({ error: 'Erro ao salvar o curso.' });
        }
    } finally {
        client.release();
    }
});

// Helpers
function slugify(text) {
    return text.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function extractVideoRef(url) {
    if (!url) return url;
    const u = url.trim();
    const watchMatch = u.match(/[?&]v=([^&\s]+)/);
    if (watchMatch) return watchMatch[1];
    const shortMatch = u.match(/youtu\.be\/([^?&\s]+)/);
    if (shortMatch) return shortMatch[1];
    const embedMatch = u.match(/\/embed\/([^?&\s]+)/);
    if (embedMatch) return embedMatch[1];
    return u; // já é um ID ou outra URL
}

// 5. Login (com suporte a bcrypt + migração automática de senhas legadas)
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, error: 'E-mail e senha são obrigatórios' });
    }

    try {
        const userResult = await pool.query(
            'SELECT * FROM public.users WHERE email = $1',
            [email]
        );

        if (userResult.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
        }

        const user = userResult.rows[0];
        let passwordMatch = false;

        // Suporte a hashes bcrypt e senhas legadas em texto plano
        if (user.password_hash.startsWith('$2b$') || user.password_hash.startsWith('$2a$')) {
            passwordMatch = await bcrypt.compare(password, user.password_hash);
        } else {
            // Comparação legada (texto plano)
            passwordMatch = (password === user.password_hash);
            if (passwordMatch) {
                // Migração automática para bcrypt
                const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
                await pool.query('UPDATE public.users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
                console.log(`[AUTH] Senha do usuário ${user.id} migrada para bcrypt`);
            }
        }

        if (passwordMatch) {
            const userData = { id: user.id, email: user.email, name: user.full_name, role: user.role };
            const token = jwt.sign(userData, JWT_SECRET, { expiresIn: '24h' });
            res.json({ success: true, token, user: userData });
        } else {
            res.status(401).json({ success: false, error: 'Credenciais inválidas' });
        }
    } catch (err) {
        console.error('Erro no login:', err);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// 5. Registro (somente Admin)
app.post('/api/auth/register', authenticateToken, requireAdmin, async (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }
    try {
        const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const result = await pool.query(
            'INSERT INTO public.users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id',
            [email, hash, name]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        if (err.code === '23505') {
            res.status(409).json({ error: 'Este e-mail já está em uso' });
        } else {
            console.error('Erro no registro:', err);
            res.status(500).json({ error: 'Erro ao registrar usuário' });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Sage Backend rodando em http://localhost:${PORT}`);
});
