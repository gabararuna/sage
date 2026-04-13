/**
 * SAGE LMS — Cloudflare Pages Function
 * Handles all /api/* routes
 *
 * Runtime: Cloudflare Workers (V8 isolate)
 * DB:  Neon.tech via @neondatabase/serverless (HTTP)
 * JWT: jose (Web Crypto API)
 * PWD: bcryptjs (pure JS)
 */

import { neon } from '@neondatabase/serverless';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 8; // Compatível com Workers; verifica hashes legados com rounds maiores

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSecret(env) {
    return new TextEncoder().encode(env.JWT_SECRET || 'sage-fallback-secret');
}

async function signToken(payload, env) {
    return new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('24h')
        .sign(getSecret(env));
}

async function verifyToken(token, env) {
    try {
        const { payload } = await jwtVerify(token, getSecret(env));
        return payload;
    } catch {
        return null;
    }
}

async function authenticate(request, env) {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.split(' ')[1];
    if (!token) return null;
    return verifyToken(token, env);
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}

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
    return u;
}

// ─── Handler principal ─────────────────────────────────────────────────────────

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api/, '') || '/';
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            }
        });
    }

    const sql = neon(env.DATABASE_URL);

    try {

        // ── GET /health ──────────────────────────────────────────────────────
        if (path === '/health' && method === 'GET') {
            return json({ status: 'ok', message: 'Servidor Sage está vivo!' });
        }

        // ── POST /auth/login ─────────────────────────────────────────────────
        if (path === '/auth/login' && method === 'POST') {
            const { email, password } = await request.json();
            if (!email || !password) {
                return json({ success: false, error: 'E-mail e senha são obrigatórios' }, 400);
            }

            const rows = await sql`SELECT * FROM public.users WHERE email = ${email}`;
            if (!rows.length) {
                return json({ success: false, error: 'Credenciais inválidas' }, 401);
            }

            const user = rows[0];
            let passwordMatch = false;

            if (user.password_hash.startsWith('$2b$') || user.password_hash.startsWith('$2a$')) {
                passwordMatch = await bcrypt.compare(password, user.password_hash);
            } else {
                // Senha legada (texto plano) — migra para bcrypt automaticamente
                passwordMatch = (password === user.password_hash);
                if (passwordMatch) {
                    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
                    await sql`UPDATE public.users SET password_hash = ${hash} WHERE id = ${user.id}`;
                }
            }

            if (!passwordMatch) {
                return json({ success: false, error: 'Credenciais inválidas' }, 401);
            }

            const userData = { id: user.id, email: user.email, name: user.full_name, role: user.role };
            const token = await signToken(userData, env);
            return json({ success: true, token, user: userData });
        }

        // ── POST /auth/register ──────────────────────────────────────────────
        if (path === '/auth/register' && method === 'POST') {
            const user = await authenticate(request, env);
            if (!user) return json({ error: 'Token não fornecido' }, 401);
            if (user.role !== 'admin') return json({ error: 'Acesso negado: requer Admin' }, 403);

            const { email, password, name } = await request.json();
            if (!email || !password || !name) {
                return json({ error: 'Todos os campos são obrigatórios' }, 400);
            }

            const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
            try {
                const result = await sql`
                    INSERT INTO public.users (email, password_hash, full_name)
                    VALUES (${email}, ${hash}, ${name}) RETURNING id
                `;
                return json({ success: true, id: result[0].id });
            } catch (err) {
                if (err.code === '23505') return json({ error: 'Este e-mail já está em uso' }, 409);
                throw err;
            }
        }

        // ── GET /catalog ─────────────────────────────────────────────────────
        if (path === '/catalog' && method === 'GET') {
            const user = await authenticate(request, env);
            if (!user) return json({ error: 'Token não fornecido' }, 401);

            const cats = await sql`SELECT id, name, slug FROM public.categories ORDER BY name ASC`;
            const courses = await sql`
                SELECT
                    c.category_id, c.title, c.slug, c.banner_url as banner,
                    (SELECT count(*) FROM public.episodes ep
                     JOIN public.modules m ON ep.module_id = m.id
                     WHERE m.course_id = c.id) as episode_count
                FROM public.courses c
            `;

            const categories = cats.map(cat => ({
                ...cat,
                courses: courses
                    .filter(c => c.category_id === cat.id)
                    .map(c => ({
                        id: c.slug,
                        title: c.title,
                        banner: c.banner,
                        episode_count: parseInt(c.episode_count) || 0
                    }))
            }));

            return json({ categories });
        }

        // ── GET /course/:slug ────────────────────────────────────────────────
        const courseMatch = path.match(/^\/course\/([^/]+)$/);
        if (courseMatch && method === 'GET') {
            const user = await authenticate(request, env);
            if (!user) return json({ error: 'Token não fornecido' }, 401);

            const slug = courseMatch[1];
            const courseRows = await sql`
                SELECT id, title, slug, description, banner_url as banner
                FROM public.courses WHERE slug = ${slug}
            `;
            if (!courseRows.length) return json({ error: 'Curso não encontrado' }, 404);

            const course = courseRows[0];
            const moduleRows = await sql`
                SELECT id as mod_id, title as mod_title, "order" as mod_order
                FROM public.modules WHERE course_id = ${course.id} ORDER BY "order"
            `;

            const modules = [];
            for (const mod of moduleRows) {
                const episodes = await sql`
                    SELECT id, title, description, duration, banner_url as banner
                    FROM public.episodes WHERE module_id = ${mod.mod_id} ORDER BY "order"
                `;
                modules.push({ ...mod, episodes });
            }

            return json({ ...course, modules });
        }

        // ── GET /play/:episodeId ─────────────────────────────────────────────
        const playMatch = path.match(/^\/play\/(\d+)$/);
        if (playMatch && method === 'GET') {
            const user = await authenticate(request, env);
            if (!user) return json({ error: 'Token não fornecido' }, 401);

            const epId = parseInt(playMatch[1]);
            const rows = await sql`SELECT video_url FROM public.episodes WHERE id = ${epId}`;
            if (!rows.length) return json({ error: 'Conteúdo não encontrado' }, 404);
            return json({ ref: rows[0].video_url });
        }

        // ── GET /admin/course-edit/:slug ─────────────────────────────────────
        const adminEditMatch = path.match(/^\/admin\/course-edit\/([^/]+)$/);
        if (adminEditMatch && method === 'GET') {
            const user = await authenticate(request, env);
            if (!user) return json({ error: 'Token não fornecido' }, 401);
            if (user.role !== 'admin') return json({ error: 'Acesso negado' }, 403);

            const slug = adminEditMatch[1];
            const courseRows = await sql`
                SELECT c.id, c.title, c.slug, cat.name as category_name
                FROM public.courses c
                JOIN public.categories cat ON cat.id = c.category_id
                WHERE c.slug = ${slug}
            `;
            if (!courseRows.length) return json({ error: 'Curso não encontrado' }, 404);

            const course = courseRows[0];
            const episodes = await sql`
                SELECT e.id, e.title, e.video_url, e."order"
                FROM public.episodes e
                JOIN public.modules m ON m.id = e.module_id
                WHERE m.course_id = ${course.id}
                ORDER BY m."order", e."order"
            `;

            return json({
                id: course.id,
                title: course.title,
                slug: course.slug,
                categoryName: course.category_name,
                episodes: episodes.map(e => ({
                    id: e.id,
                    title: e.title,
                    videoUrl: e.video_url,
                    order: e.order
                }))
            });
        }

        // ── POST /admin/course ───────────────────────────────────────────────
        if (path === '/admin/course' && method === 'POST') {
            const user = await authenticate(request, env);
            if (!user) return json({ error: 'Token não fornecido' }, 401);
            if (user.role !== 'admin') return json({ error: 'Acesso negado' }, 403);

            const { courseName, categoryName, episodes } = await request.json();
            if (!courseName?.trim() || !categoryName?.trim() || !episodes?.length) {
                return json({ error: 'Nome do curso, categoria e ao menos um episódio são obrigatórios.' }, 400);
            }

            // Categoria
            const catSlug = slugify(categoryName);
            let catRows = await sql`SELECT id FROM public.categories WHERE slug = ${catSlug}`;
            let categoryId;
            if (catRows.length) {
                categoryId = catRows[0].id;
            } else {
                const r = await sql`INSERT INTO public.categories (name, slug) VALUES (${categoryName.trim()}, ${catSlug}) RETURNING id`;
                categoryId = r[0].id;
            }

            // Curso
            const courseSlug = slugify(courseName) + '-' + Date.now();
            const courseResult = await sql`
                INSERT INTO public.courses (category_id, title, slug)
                VALUES (${categoryId}, ${courseName.trim()}, ${courseSlug}) RETURNING id
            `;
            const courseId = courseResult[0].id;

            // Módulo padrão
            const modResult = await sql`
                INSERT INTO public.modules (course_id, title, "order")
                VALUES (${courseId}, 'Aulas', 1) RETURNING id
            `;
            const moduleId = modResult[0].id;

            // Episódios
            for (let i = 0; i < episodes.length; i++) {
                const { title, url } = episodes[i];
                if (!title?.trim() || !url?.trim()) continue;
                const videoRef = extractVideoRef(url);
                await sql`
                    INSERT INTO public.episodes (module_id, title, video_url, "order")
                    VALUES (${moduleId}, ${title.trim()}, ${videoRef}, ${i + 1})
                `;
            }

            return json({ success: true, courseSlug });
        }

        // ── PUT /admin/course/:slug ──────────────────────────────────────────
        const adminPutMatch = path.match(/^\/admin\/course\/([^/]+)$/);
        if (adminPutMatch && method === 'PUT') {
            const user = await authenticate(request, env);
            if (!user) return json({ error: 'Token não fornecido' }, 401);
            if (user.role !== 'admin') return json({ error: 'Acesso negado' }, 403);

            const slug = adminPutMatch[1];
            const { courseName, categoryName, episodes } = await request.json();

            if (!courseName?.trim() || !categoryName?.trim()) {
                return json({ error: 'Nome do curso e categoria são obrigatórios.' }, 400);
            }

            const courseCheck = await sql`SELECT id FROM public.courses WHERE slug = ${slug}`;
            if (!courseCheck.length) return json({ error: 'Curso não encontrado' }, 404);
            const courseId = courseCheck[0].id;

            // Categoria
            const catSlug = slugify(categoryName);
            let catRows = await sql`SELECT id FROM public.categories WHERE slug = ${catSlug}`;
            let categoryId;
            if (catRows.length) {
                categoryId = catRows[0].id;
            } else {
                const r = await sql`INSERT INTO public.categories (name, slug) VALUES (${categoryName.trim()}, ${catSlug}) RETURNING id`;
                categoryId = r[0].id;
            }

            await sql`UPDATE public.courses SET title = ${courseName.trim()}, category_id = ${categoryId} WHERE id = ${courseId}`;

            // Módulo
            let modRows = await sql`SELECT id FROM public.modules WHERE course_id = ${courseId} ORDER BY "order" ASC LIMIT 1`;
            let moduleId;
            if (modRows.length) {
                moduleId = modRows[0].id;
            } else {
                const r = await sql`INSERT INTO public.modules (course_id, title, "order") VALUES (${courseId}, 'Aulas', 1) RETURNING id`;
                moduleId = r[0].id;
            }

            const sentEpisodes = (episodes || []).filter(ep => ep.title?.trim());
            const sentIds = sentEpisodes.filter(ep => ep.id).map(ep => Number(ep.id));

            if (sentIds.length > 0) {
                await sql`DELETE FROM public.episodes WHERE module_id = ${moduleId} AND id != ALL(${sentIds}::int[])`;
            } else {
                await sql`DELETE FROM public.episodes WHERE module_id = ${moduleId}`;
            }

            for (let i = 0; i < sentEpisodes.length; i++) {
                const ep = sentEpisodes[i];
                if (ep.id) {
                    if (ep.url?.trim()) {
                        await sql`UPDATE public.episodes SET title = ${ep.title.trim()}, "order" = ${i + 1}, video_url = ${extractVideoRef(ep.url.trim())} WHERE id = ${Number(ep.id)}`;
                    } else {
                        await sql`UPDATE public.episodes SET title = ${ep.title.trim()}, "order" = ${i + 1} WHERE id = ${Number(ep.id)}`;
                    }
                } else {
                    if (!ep.url?.trim()) continue;
                    await sql`
                        INSERT INTO public.episodes (module_id, title, video_url, "order")
                        VALUES (${moduleId}, ${ep.title.trim()}, ${extractVideoRef(ep.url.trim())}, ${i + 1})
                    `;
                }
            }

            return json({ success: true });
        }

        return json({ error: 'Rota não encontrada' }, 404);

    } catch (err) {
        console.error('[Sage Worker] Erro:', err.message);
        return json({ error: 'Erro interno do servidor' }, 500);
    }
}
