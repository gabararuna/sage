/**
 * SAGE LMS App Logic - Modernized
 */

let lmsData = null;
let player = null;
let currentEpId = null;
let currentCourseId = null;

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    console.log('SAGE: App iniciado');
    
    // Robust detection: check for #catalog-root or the playback wrapper
    const catalogRoot = document.getElementById('catalog-root');
    const isPlayerPage = !!document.getElementById('video-wrapper');
    
    console.log('SAGE: Tipo de página:', isPlayerPage ? 'Player' : 'Catálogo');

    if (!isPlayerPage && catalogRoot) {
        console.log('SAGE: Mostrando skeletons');
        showSkeletons();
    }

    try {
        console.log('SAGE: Buscando data.json...');
        const response = await fetch('data.json');
        if (!response.ok) throw new Error(`Status HTTP: ${response.status}`);
        lmsData = await response.json();
        console.log('SAGE: Dados carregados com sucesso');
        
        initApp(isPlayerPage);
    } catch (err) {
        console.error('SAGE ERROR: Falha ao carregar data.json', err);
        const root = document.getElementById('catalog-root');
        if (root) {
            root.innerHTML = `<div style="padding: 4%; color: #ef4444; background: rgba(239, 68, 68, 0.1); border-radius: 8px;">
                <strong>Erro de Carregamento:</strong><br>
                ${err.message}. Certifique-se de estar usando um servidor local (localhost) e que o arquivo data.json existe.
            </div>`;
        }
    }
});

function showSkeletons() {
    const root = document.getElementById('catalog-root');
    if (!root) return;
    
    root.innerHTML = `
        <section class="category-section">
            <div class="skeleton" style="width: 200px; height: 30px; margin-bottom: 2rem;"></div>
            <div class="carousel-container" style="overflow: hidden;">
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

// --- CATALOG LOGIC ---

function renderCatalog() {
    const root = document.getElementById('catalog-root');
    if (!root) return;
    
    root.innerHTML = '';

    if (!lmsData || !lmsData.categories || lmsData.categories.length === 0) {
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
                <button class="carousel-btn prev" aria-label="Anterior">❮</button>
                <div class="carousel-container"></div>
                <button class="carousel-btn next" aria-label="Próximo">❯</button>
            </div>
        `;
        
        const container = section.querySelector('.carousel-container');

        if (category.courses.length === 0) {
            container.innerHTML = '<div class="empty-state">Em breve...</div>';
        } else {
            category.courses.forEach((course, courseIdx) => {
                const isCompleted = checkIfCourseCompleted(course.id);
                const card = document.createElement('div');
                card.className = 'course-card animate-in visible';
                card.style.animationDelay = `${(catIdx * 0.2) + (courseIdx * 0.05)}s`;
                
                card.innerHTML = `
                    <div class="course-banner">
                        <img src="${course.banner}" alt="${course.title}" loading="lazy">
                    </div>
                    <div class="card-progress ${isCompleted ? 'completed' : ''}">✓</div>
                    <div class="course-info">
                        <h3 class="course-title">${course.title}</h3>
                        <p class="course-meta">${countEpisodes(course)} Episódios</p>
                    </div>
                `;
                
                card.onclick = () => {
                    const firstEp = course.modules[0].episodes[0].id;
                    window.location.href = `player.html?curso=${course.id}&ep=${firstEp}`;
                };
                
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
    
    if (prev && next && container) {
        prev.onclick = () => container.scrollBy({ left: -400, behavior: 'smooth' });
        next.onclick = () => container.scrollBy({ left: 400, behavior: 'smooth' });
    }
}

function countEpisodes(course) {
    return course.modules.reduce((acc, m) => acc + m.episodes.length, 0);
}

// --- PLAYER LOGIC ---

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
    if (!episode) return;

    updatePlayerInfo(episode);
    initCustomControls();
    blockContextMenu();
    
    renderBreadcrumbs(course);
    renderSidebar(course);
    
    // Mobile Menu Toggle
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    
    function toggleSidebar() {
        if (!sidebar || !backdrop) return;
        const isActive = sidebar.classList.toggle('active');
        backdrop.classList.toggle('active');
        document.body.classList.toggle('menu-open');
        document.documentElement.classList.toggle('menu-open'); // For stronger scroll lock
        const icon = menuToggle.querySelector('span');
        if (icon) icon.textContent = isActive ? '✕' : '☰';
    }

    if (menuToggle && sidebar && backdrop) {
        menuToggle.onclick = (e) => {
            e.stopPropagation();
            toggleSidebar();
        };

        backdrop.onclick = () => {
            if (sidebar.classList.contains('active')) {
                toggleSidebar();
            }
        };
    }

    // Video Area Click interaction
    const overlay = document.getElementById('overlay');
    const cover = document.getElementById('video-cover');
    if (cover) {
        cover.style.backgroundImage = `url('${episode.banner}')`;
        cover.addEventListener('click', () => {
            if (player && player.playVideo) {
                player.playVideo();
                // Transition handled in onPlayerStateChange
            }
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            if (!player) return;
            const state = player.getPlayerState();
            if (state === 1) { // Playing
                player.pauseVideo();
            } else {
                player.playVideo();
            }
        });
    }

    // Mark as complete
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
    for (let cat of lmsData.categories) {
        const found = cat.courses.find(c => c.id === id);
        if (found) return found;
    }
    return null;
}

function findEpisode(course, id) {
    for (let mod of course.modules) {
        const ep = mod.episodes.find(e => e.id === id);
        if (ep) return ep;
    }
    return null;
}

function renderBreadcrumbs(course) {
    const container = document.getElementById('player-breadcrumbs');
    if (!container) return;

    container.innerHTML = `
        <a href="index.html">Sage</a>
        <span>&gt;</span>
        <span style="color: var(--text-primary)">${course.title}</span>
    `;
}

function renderSidebar(course) {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    
    sidebar.innerHTML = `<h2>${course.title}</h2>`;
    
    course.modules.forEach(mod => {
        const modTitle = document.createElement('div');
        modTitle.className = 'module-title';
        modTitle.innerText = mod.title;
        sidebar.appendChild(modTitle);
        
        mod.episodes.forEach((ep, idx) => {
            const item = document.createElement('div');
            item.className = `episode-item ${ep.id === currentEpId ? 'active' : ''}`;
            
            const isCompleted = isEpisodeCompleted(ep.id);
            
            item.innerHTML = `
                <div class="ep-number">${(idx + 1).toString().padStart(2, '0')}</div>
                <div class="ep-content">
                    <div class="ep-title">${ep.title}</div>
                    <div class="ep-duration">${ep.duration}</div>
                </div>
                <div class="ep-check ${isCompleted ? 'completed' : ''}">✓</div>
            `;
            
            item.onclick = () => {
                window.location.href = `player.html?curso=${course.id}&ep=${ep.id}`;
            };
            
            sidebar.appendChild(item);
        });
    });
}

function updatePlayerInfo(episode) {
    const title = document.getElementById('playing-title');
    const desc = document.getElementById('playing-desc');
    if (title) title.innerText = episode.title;
    if (desc) desc.innerText = episode.description;
}

// YouTube API Callback
function onYouTubeIframeAPIReady() {
    const params = new URLSearchParams(window.location.search);
    const courseId = params.get('curso');
    const epId = params.get('ep');
    
    if (!lmsData) {
        // Retry if data not loaded yet
        setTimeout(onYouTubeIframeAPIReady, 100);
        return;
    }

    const course = findCourse(courseId);
    const episode = findEpisode(course, epId);
    
    if (episode) {
        player = new YT.Player('player', {
            videoId: episode.youtubeId,
            playerVars: {
                'controls': 0,
                'modestbranding': 1,
                'rel': 0,
                'cc_load_policy': 1,
                'iv_load_policy': 3,
                'disablekb': 1,
                'origin': window.location.origin
            },
            events: {
                'onReady': onPlayerReady,
                'onStateChange': onPlayerStateChange,
                'onError': onPlayerError
            }
        });
    }
}

function onPlayerReady(event) {
    console.log('Player Pronto');
}

function onPlayerError(event) {
    console.error('Erro no Player YouTube:', event.data);
    const errorOverlay = document.getElementById('video-error');
    const cover = document.getElementById('video-cover');
    if (errorOverlay) {
        errorOverlay.style.display = 'flex';
    }
    if (cover) {
        cover.style.display = 'none';
    }
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
                if (player.getPlayerState() === 1) cover.style.display = 'none';
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

function initCustomControls() {
    const playBtn = document.getElementById('play-pause');
    const muteBtn = document.getElementById('mute-unmute');
    const fsBtn = document.getElementById('fullscreen');
    const progressContainer = document.getElementById('progress-container');
    
    if (playBtn) {
        playBtn.onclick = () => {
            const state = player.getPlayerState();
            if (state === YT.PlayerState.PLAYING) {
                player.pauseVideo();
            } else {
                player.playVideo();
            }
        };
    }

    if (muteBtn) {
        muteBtn.onclick = () => {
            const volUp = document.getElementById('volume-up');
            const volOff = document.getElementById('volume-off');
            if (player.isMuted()) {
                player.unMute();
                volUp.style.display = 'block';
                volOff.style.display = 'none';
            } else {
                player.mute();
                volUp.style.display = 'none';
                volOff.style.display = 'block';
            }
        };
    }

    if (fsBtn) {
        fsBtn.onclick = () => {
            const wrapper = document.getElementById('video-wrapper');
            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                if (wrapper.requestFullscreen) wrapper.requestFullscreen();
                else if (wrapper.webkitRequestFullscreen) wrapper.webkitRequestFullscreen();
            } else {
                if (document.exitFullscreen) document.exitFullscreen();
                else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
            }
        };
    }

    // Skip Buttons
    const skipBack = document.getElementById('skip-back');
    const skipForward = document.getElementById('skip-forward');
    if (skipBack) {
        skipBack.onclick = () => {
            if (player) player.seekTo(player.getCurrentTime() - 10, true);
        };
    }
    if (skipForward) {
        skipForward.onclick = () => {
            if (player) player.seekTo(player.getCurrentTime() + 10, true);
        };
    }

    // Captions Toggle
    const ccBtn = document.getElementById('toggle-captions');
    if (ccBtn) {
        let ccEnabled = true; // matches cc_load_policy: 1
        ccBtn.onclick = () => {
            if (!player) return;
            ccEnabled = !ccEnabled;
            if (ccEnabled) {
                player.loadModule('captions');
                ccBtn.style.color = 'var(--accent-primary)';
            } else {
                player.unloadModule('captions');
                ccBtn.style.color = 'white';
            }
        };
    }

    if (progressContainer) {
        progressContainer.onclick = (e) => {
            const rect = progressContainer.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            player.seekTo(pos * player.getDuration(), true);
        };
    }
}

function startProgressLoop() {
    setInterval(() => {
        if (player && player.getCurrentTime) {
            const progress = (player.getCurrentTime() / player.getDuration()) * 100;
            const bar = document.getElementById('progress-bar');
            if (bar) bar.style.width = progress + '%';
        }
    }, 1000);
}

function blockContextMenu() {
    document.addEventListener('contextmenu', e => e.preventDefault());
}

// --- PROGRESS SYSTEM ---

function markAsComplete(epId, courseId) {
    let completed = JSON.parse(localStorage.getItem('sage_progress') || '[]');
    if (!completed.includes(epId)) {
        completed.push(epId);
        localStorage.setItem('sage_progress', JSON.stringify(completed));
    }
    
    // Update UI
    const btn = document.getElementById('mark-complete');
    if (btn) {
        btn.innerText = 'Concluído ✓';
        btn.style.opacity = '0.5';
    }
    
    // Refresh sidebar to show checkmark
    const course = findCourse(courseId);
    renderSidebar(course);
}

function isEpisodeCompleted(epId) {
    const completed = JSON.parse(localStorage.getItem('sage_progress') || '[]');
    return completed.includes(epId);
}

function checkIfCourseCompleted(courseId) {
    const course = findCourse(courseId);
    if (!course) return false;
    
    const epIds = [];
    course.modules.forEach(m => m.episodes.forEach(e => epIds.push(e.id)));
    
    const completed = JSON.parse(localStorage.getItem('sage_progress') || '[]');
    return epIds.every(id => completed.includes(id));
}
