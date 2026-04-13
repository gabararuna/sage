/**
 * SAGE LMS — App Logic
 */

let lmsData = null;
let player = null;
let currentEpId = null;
let currentCourseId = null;
let progressInterval = null;

const API_URL = '/api';

// --- AUTH ---

function requireAuth() {
    try {
        const raw = localStorage.getItem('sage_auth');
        if (!raw || raw === 'undefined' || raw === 'null') {
            window.location.href = 'login.html';
            return null;
        }
        return JSON.parse(raw);
    } catch (e) {
        localStorage.removeItem('sage_auth');
        window.location.href = 'login.html';
        return null;
    }
}

function logout() {
    localStorage.removeItem('sage_auth');
    window.location.href = 'login.html';
}

// Nota: o guard de autenticação é feito inline no <head> de cada página protegida,
// antes de qualquer renderização. O app.js não precisa redirecionar aqui.

// --- IMAGE FALLBACK ---

function handleImageError(img, title) {
    const parent = img.parentElement;
    parent.classList.add('fallback');
    const initials = title.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    parent.innerHTML = `<div class="fallback-initials">${initials}</div>`;
}

// --- HEADER SCROLL EFFECT ---

window.addEventListener('scroll', () => {
    const header = document.querySelector('header');
    if (!header) return;
    header.classList.toggle('scrolled', window.scrollY > 50);
}, { passive: true });

// --- INIT ---

document.addEventListener('DOMContentLoaded', async () => {
    const catalogRoot = document.getElementById('catalog-root');
    const isPlayerPage = !!document.getElementById('video-wrapper');

    if (!isPlayerPage && catalogRoot) {
        showSkeletons();
    }

    try {
        const authInfo = requireAuth();
        if (!authInfo) return;

        const response = await fetch(`${API_URL}/catalog`, {
            headers: { 'Authorization': `Bearer ${authInfo.token}` }
        });

        if (response.status === 401 || response.status === 403) {
            logout();
            return;
        }

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        lmsData = await response.json();

        if (isPlayerPage) {
            // No player, carrega os detalhes completos do curso antes de inicializar
            const params = new URLSearchParams(window.location.search);
            const courseSlug = params.get('curso');
            if (courseSlug) {
                const courseRes = await fetch(`${API_URL}/course/${courseSlug}`, {
                    headers: { 'Authorization': `Bearer ${authInfo.token}` }
                });
                if (courseRes.ok) {
                    const fullCourse = await courseRes.json();
                    injectFullCourse(fullCourse);
                }
            }
        }

        initApp(isPlayerPage);

        if (window.lucide) window.lucide.createIcons();

    } catch (err) {
        console.error('SAGE: Falha ao carregar dados', err);

        // Fallback local para debug visual
        if (!lmsData) {
            try {
                const res = await fetch('data.json');
                lmsData = await res.json();
                initApp(isPlayerPage);
            } catch (_) { /* ignore */ }
        }

        const root = document.getElementById('catalog-root');
        if (root && !lmsData) {
            root.innerHTML = `<div class="alert alert-error" style="margin: 10% 5%;">
                <strong>Erro de Carregamento</strong><br>${err.message}
            </div>`;
        }
    }
});

function showSkeletons() {
    const root = document.getElementById('catalog-root');
    if (!root) return;
    root.innerHTML = `
        <section class="category-section">
            <div class="skeleton" style="width: 160px; height: 12px; margin-bottom: 1.5rem;"></div>
            <div class="carousel-container">
                ${'<div class="skeleton skeleton-card"></div>'.repeat(5)}
            </div>
        </section>
    `;
}

function initApp(isPlayerPage) {
    if (isPlayerPage) {
        initPlayerPage();
    } else {
        renderCatalog();
    }
}

// --- CATALOG ---

function renderCatalog() {
    const root = document.getElementById('catalog-root');
    if (!root) return;

    root.innerHTML = '';

    if (!lmsData?.categories?.length) {
        root.innerHTML = '<div class="empty-state-global">Em breve novos conteúdos...</div>';
        return;
    }

    lmsData.categories.forEach((category, catIdx) => {
        const section = document.createElement('section');
        section.className = 'category-section animate-in';
        section.style.animationDelay = `${catIdx * 0.1}s`;

        section.innerHTML = `
            <h2 class="category-title">${category.name}</h2>
            <div class="carousel-wrapper">
                <button class="carousel-btn prev" aria-label="Anterior">&#10094;</button>
                <div class="carousel-container"></div>
                <button class="carousel-btn next" aria-label="Próximo">&#10095;</button>
            </div>
        `;

        const container = section.querySelector('.carousel-container');

        if (!category.courses.length) {
            container.innerHTML = '<div class="empty-state">Em breve...</div>';
        } else {
            category.courses.forEach((course, courseIdx) => {
                const isCompleted = checkIfCourseCompleted(course.id);
                const card = document.createElement('div');
                card.className = 'course-card animate-in';
                card.style.animationDelay = `${(catIdx * 0.15) + (courseIdx * 0.05)}s`;

                const bannerUrl = course.banner && course.banner !== 'null'
                    ? course.banner
                    : 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=800';

                card.innerHTML = `
                    <div class="course-banner">
                        <img src="${bannerUrl}" alt="${course.title}" loading="lazy"
                             onerror="handleImageError(this, '${course.title.replace(/'/g, "\\'")}')">
                        <div class="hover-info">
                            <div class="play-icon">
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="black"><path d="M8 5v14l11-7z"/></svg>
                            </div>
                            <span class="ep-count">${course.episode_count || 0} Episódios</span>
                        </div>
                        <div class="course-label">
                            <h3 class="course-title">${course.title}</h3>
                        </div>
                    </div>
                    <div class="card-progress ${isCompleted ? 'completed' : ''}">✓</div>
                `;

                card.onclick = () => {
                    window.location.href = `player.html?curso=${course.id}`;
                };

                // Botão de edição para admins
                const auth = JSON.parse(localStorage.getItem('sage_auth') || '{}');
                if (auth.role === 'admin') {
                    const editBtn = document.createElement('button');
                    editBtn.className = 'card-edit-btn';
                    editBtn.title = 'Editar curso';
                    editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>`;
                    editBtn.onclick = (e) => {
                        e.stopPropagation();
                        if (typeof window.openEditModal === 'function') {
                            window.openEditModal(course.id);
                        }
                    };
                    card.appendChild(editBtn);
                }

                container.appendChild(card);
            });
        }

        root.appendChild(section);
        setupCarouselEvents(section);
    });
}

function setupCarouselEvents(section) {
    const container = section.querySelector('.carousel-container');
    const prev = section.querySelector('.prev');
    const next = section.querySelector('.next');
    if (!prev || !next || !container) return;

    prev.onclick = () => container.scrollBy({ left: -container.clientWidth * 0.8, behavior: 'smooth' });
    next.onclick = () => container.scrollBy({ left: container.clientWidth * 0.8, behavior: 'smooth' });
}

function injectFullCourse(fullCourse) {
    if (!lmsData) return;
    for (const cat of lmsData.categories) {
        const idx = cat.courses.findIndex(c => c.id === fullCourse.slug || c.slug === fullCourse.slug);
        if (idx !== -1) {
            // Preserva o id original (slug) usado para navegação — o fullCourse tem o id numérico do banco
            const navId = cat.courses[idx].id;
            cat.courses[idx] = { ...cat.courses[idx], ...fullCourse, id: navId };
            break;
        }
    }
}

// --- PLAYER ---

function initPlayerPage() {
    const params = new URLSearchParams(window.location.search);
    currentCourseId = params.get('curso');
    currentEpId = params.get('ep');

    const course = findCourse(currentCourseId);
    if (!course) {
        window.location.href = 'index.html';
        return;
    }

    const episode = findEpisode(course, currentEpId);

    if (!episode) {
        // Redirecionar para o primeiro episódio
        const firstEp = course.modules?.[0]?.episodes?.[0]?.id;
        if (firstEp) {
            window.location.href = `player.html?curso=${currentCourseId}&ep=${firstEp}`;
        }
        return;
    }

    updatePlayerInfo(episode);
    initCustomControls();
    blockContextMenu();
    renderBreadcrumbs(course);
    renderSidebar(course);

    // Mobile sidebar toggle
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');

    function toggleSidebar() {
        if (!sidebar || !backdrop) return;
        const isActive = sidebar.classList.toggle('active');
        backdrop.classList.toggle('active');
        document.body.classList.toggle('menu-open');
        const icon = menuToggle?.querySelector('span');
        if (icon) icon.textContent = isActive ? '✕' : '☰';
    }

    if (menuToggle) {
        menuToggle.onclick = (e) => {
            e.stopPropagation();
            toggleSidebar();
        };
    }

    if (backdrop) {
        backdrop.onclick = () => {
            if (sidebar?.classList.contains('active')) toggleSidebar();
        };
    }

    // Video cover / poster
    const cover = document.getElementById('video-cover');
    if (cover) {
        const bannerUrl = episode.banner && episode.banner !== 'null'
            ? episode.banner
            : 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=800';
        cover.style.backgroundImage = `url('${bannerUrl}')`;
        cover.style.display = 'flex';
        cover.addEventListener('click', () => player?.playVideo?.());
    }

    // Shield click → play/pause
    const shield = document.getElementById('video-shield');
    if (shield) {
        shield.addEventListener('click', () => {
            if (!player) return;
            player.getPlayerState() === 1 ? player.pauseVideo() : player.playVideo();
        });
        shield.addEventListener('dblclick', e => e.preventDefault());
    }

    // Block devtools shortcuts
    window.addEventListener('keydown', (e) => {
        if (e.keyCode === 123 ||
            (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74)) ||
            (e.ctrlKey && (e.keyCode === 85 || e.keyCode === 83))) {
            e.preventDefault();
        }
    });

    // Mark as complete button
    const completeBtn = document.getElementById('mark-complete');
    if (completeBtn) {
        if (isEpisodeCompleted(currentEpId)) {
            completeBtn.innerText = 'Concluído ✓';
            completeBtn.style.opacity = '0.5';
        }
        completeBtn.onclick = () => markAsComplete(currentEpId, currentCourseId);
    }
}

function findCourse(id) {
    if (!lmsData) return null;
    for (const cat of lmsData.categories) {
        const found = cat.courses.find(c => c.id === id);
        if (found) return found;
    }
    return null;
}

function findEpisode(course, id) {
    if (!course?.modules) return null;
    for (const mod of course.modules) {
        const ep = mod.episodes?.find(e => String(e.id) === String(id));
        if (ep) return ep;
    }
    return null;
}

function renderBreadcrumbs(course) {
    const container = document.getElementById('player-breadcrumbs');
    if (!container) return;
    container.innerHTML = `
        <a href="index.html">Catálogo</a>
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        <span>${course.title}</span>
    `;
}

function renderSidebar(course) {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    sidebar.innerHTML = `
        <div class="sidebar-header">
            <h2>${course.title}</h2>
        </div>
        <div class="episodes-list" id="episodes-list"></div>
    `;

    const listContainer = sidebar.querySelector('#episodes-list');

    course.modules?.forEach(mod => {
        const modTitle = document.createElement('div');
        modTitle.className = 'module-title';
        modTitle.innerText = mod.mod_title || mod.title;
        listContainer.appendChild(modTitle);

        const episodes = mod.episodes || [];
        episodes.forEach((ep, idx) => {
            const item = document.createElement('div');
            item.className = `episode-item ${String(ep.id) === String(currentEpId) ? 'active' : ''}`;

            const isCompleted = isEpisodeCompleted(ep.id);

            item.innerHTML = `
                <div class="ep-number">${String(idx + 1).padStart(2, '0')}</div>
                <div class="ep-content">
                    <div class="ep-title">${ep.title}</div>
                    <div class="ep-duration">${ep.duration || ''}</div>
                </div>
                <div class="ep-check ${isCompleted ? 'completed' : ''}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                </div>
            `;

            item.onclick = () => {
                window.location.href = `player.html?curso=${course.id || course.slug}&ep=${ep.id}`;
            };

            listContainer.appendChild(item);
        });
    });
}

function updatePlayerInfo(episode) {
    const title = document.getElementById('playing-title');
    const desc = document.getElementById('playing-desc');
    if (title) title.innerText = episode.title;
    if (desc) desc.innerText = episode.description || '';
}

// --- PLAYER API CALLBACK (carregado pelo script externo) ---

function onYouTubeIframeAPIReady() {
    const params = new URLSearchParams(window.location.search);
    const epId = params.get('ep');

    if (!epId) {
        setTimeout(onYouTubeIframeAPIReady, 200);
        return;
    }

    const authInfo = requireAuth();
    if (!authInfo) return;

    // Busca a referência do conteúdo no servidor (isola a origem do vídeo)
    fetch(`${API_URL}/play/${epId}`, {
        headers: { 'Authorization': `Bearer ${authInfo.token}` }
    })
    .then(r => {
        if (!r.ok) throw new Error('Conteúdo não disponível');
        return r.json();
    })
    .then(data => {
        if (!data.ref) throw new Error('Referência inválida');
        initMediaPlayer(data.ref);
    })
    .catch(err => {
        console.error('SAGE: Erro ao carregar conteúdo', err);
        const errorEl = document.getElementById('video-error');
        if (errorEl) errorEl.style.display = 'flex';
        const cover = document.getElementById('video-cover');
        if (cover) cover.style.display = 'none';
    });
}

function initMediaPlayer(ref) {
    player = new YT.Player('player', {
        videoId: ref,
        playerVars: {
            controls: 0,
            modestbranding: 1,
            rel: 0,
            cc_load_policy: 1,
            iv_load_policy: 3,
            disablekb: 1,
            origin: window.location.origin
        },
        events: {
            onReady: onPlayerReady,
            onStateChange: onPlayerStateChange,
            onError: onPlayerError
        }
    });
}

function onPlayerReady() {
    // Player pronto
}

function onPlayerError(event) {
    console.error('SAGE: Erro no player', event.data);
    const errorEl = document.getElementById('video-error');
    if (errorEl) errorEl.style.display = 'flex';
    const cover = document.getElementById('video-cover');
    if (cover) cover.style.display = 'none';
}

function onPlayerStateChange(event) {
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    const cover = document.getElementById('video-cover');

    if (event.data === YT.PlayerState.PLAYING) {
        if (playIcon) playIcon.style.display = 'none';
        if (pauseIcon) pauseIcon.style.display = 'block';
        if (cover) {
            cover.style.opacity = '0';
            setTimeout(() => {
                if (player?.getPlayerState() === 1) cover.style.display = 'none';
            }, 500);
        }
        startProgressLoop();
    } else if (event.data === YT.PlayerState.PAUSED) {
        if (playIcon) playIcon.style.display = 'block';
        if (pauseIcon) pauseIcon.style.display = 'none';
        if (cover) {
            cover.style.display = 'flex';
            setTimeout(() => cover.style.opacity = '1', 10);
        }
        stopProgressLoop();
    } else {
        if (playIcon) playIcon.style.display = 'block';
        if (pauseIcon) pauseIcon.style.display = 'none';
        stopProgressLoop();
    }
}

// --- CUSTOM CONTROLS ---

function initCustomControls() {
    const playBtn = document.getElementById('play-pause');
    const muteBtn = document.getElementById('mute-unmute');
    const fsBtn = document.getElementById('fullscreen');
    const progressContainer = document.getElementById('progress-container');
    const skipBack = document.getElementById('skip-back');
    const skipForward = document.getElementById('skip-forward');

    if (playBtn) {
        playBtn.onclick = () => {
            if (!player) return;
            player.getPlayerState() === YT.PlayerState.PLAYING
                ? player.pauseVideo()
                : player.playVideo();
        };
    }

    if (muteBtn) {
        muteBtn.onclick = () => {
            if (!player) return;
            const volUp = document.getElementById('volume-up');
            const volOff = document.getElementById('volume-off');
            if (player.isMuted()) {
                player.unMute();
                if (volUp) volUp.style.display = 'block';
                if (volOff) volOff.style.display = 'none';
            } else {
                player.mute();
                if (volUp) volUp.style.display = 'none';
                if (volOff) volOff.style.display = 'block';
            }
        };
    }

    if (fsBtn) {
        fsBtn.onclick = () => {
            const wrapper = document.getElementById('video-wrapper');
            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                (wrapper.requestFullscreen || wrapper.webkitRequestFullscreen).call(wrapper);
            } else {
                (document.exitFullscreen || document.webkitExitFullscreen).call(document);
            }
        };
    }

    if (skipBack) {
        skipBack.onclick = () => player?.seekTo(player.getCurrentTime() - 10, true);
    }
    if (skipForward) {
        skipForward.onclick = () => player?.seekTo(player.getCurrentTime() + 10, true);
    }

    const ccBtn = document.getElementById('toggle-captions');
    if (ccBtn) {
        let ccEnabled = true;
        ccBtn.onclick = () => {
            if (!player) return;
            ccEnabled = !ccEnabled;
            ccEnabled ? player.loadModule('captions') : player.unloadModule('captions');
            ccBtn.style.color = ccEnabled ? 'var(--accent-emerald)' : 'white';
        };
    }

    if (progressContainer) {
        progressContainer.onclick = (e) => {
            if (!player) return;
            const rect = progressContainer.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            player.seekTo(pos * player.getDuration(), true);
        };
    }
}

// --- PROGRESS LOOP ---

function startProgressLoop() {
    stopProgressLoop();
    progressInterval = setInterval(() => {
        if (!player?.getCurrentTime) return;
        const total = player.getDuration();
        if (!total) return;
        const progress = (player.getCurrentTime() / total) * 100;
        const bar = document.getElementById('progress-bar');
        if (bar) bar.style.width = progress + '%';
    }, 500);
}

function stopProgressLoop() {
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
}

function blockContextMenu() {
    document.addEventListener('contextmenu', e => e.preventDefault());
}

// --- PROGRESS SYSTEM ---

function markAsComplete(epId, courseId) {
    let completed = JSON.parse(localStorage.getItem('sage_progress') || '[]');
    if (!completed.includes(String(epId))) {
        completed.push(String(epId));
        localStorage.setItem('sage_progress', JSON.stringify(completed));
    }

    const btn = document.getElementById('mark-complete');
    if (btn) {
        btn.innerText = 'Concluído ✓';
        btn.style.opacity = '0.5';
    }

    const course = findCourse(courseId);
    if (course) renderSidebar(course);
}

function isEpisodeCompleted(epId) {
    const completed = JSON.parse(localStorage.getItem('sage_progress') || '[]');
    return completed.includes(String(epId));
}

function checkIfCourseCompleted(courseId) {
    const course = findCourse(courseId);
    if (!course?.modules) return false;

    const epIds = [];
    course.modules.forEach(m => (m.episodes || []).forEach(e => epIds.push(String(e.id))));
    if (!epIds.length) return false;

    const completed = JSON.parse(localStorage.getItem('sage_progress') || '[]');
    return epIds.every(id => completed.includes(id));
}
