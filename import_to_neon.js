const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrate() {
  console.log('--- Iniciando Migração para o Neon.tech ---');
  
  try {
    const rawData = fs.readFileSync('data.json', 'utf8');
    const data = JSON.parse(rawData);

    for (const cat of data.categories) {
      console.log(`Migrando categoria: ${cat.name}`);
      const catRes = await pool.query(
        'INSERT INTO public.categories (name, slug) VALUES ($1, $2) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id',
        [cat.name, cat.name.toLowerCase().replace(/ /g, '-')]
      );
      const categoryId = catRes.rows[0].id;

      for (const course of cat.courses) {
        console.log(`  > Migrando curso: ${course.title}`);
        const courseRes = await pool.query(
          'INSERT INTO public.courses (category_id, title, slug, description, banner_url, is_published) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title RETURNING id',
          [categoryId, course.title, course.id, course.description || '', course.banner, true]
        );
        const courseId = courseRes.rows[0].id;

        for (let mIdx = 0; mIdx < course.modules.length; mIdx++) {
          const mod = course.modules[mIdx];
          const modRes = await pool.query(
            'INSERT INTO public.modules (course_id, title, "order") VALUES ($1, $2, $3) RETURNING id',
            [courseId, mod.title, mIdx]
          );
          const moduleId = modRes.rows[0].id;

          for (let eIdx = 0; eIdx < mod.episodes.length; eIdx++) {
            const ep = mod.episodes[eIdx];
            await pool.query(
              'INSERT INTO public.episodes (module_id, title, description, video_url, duration, "order", banner_url) VALUES ($1, $2, $3, $4, $5, $6, $7)',
              [moduleId, ep.title, ep.description || '', ep.youtubeId, ep.duration, eIdx, ep.banner || '']
            );
          }
        }
      }
    }

    console.log('--- Migração concluída com sucesso! ---');
  } catch (err) {
    console.error('ERRO NA MIGRAÇÃO:', err);
  } finally {
    await pool.end();
  }
}

migrate();
