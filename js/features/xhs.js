let currentXhsData = null;

function initXhsParser() {
    const entryBtn = document.getElementById('xhs-parser-function');
    const modal = document.getElementById('xhs-parser-modal');
    const closeBtn = document.getElementById('close-xhs-parser');
    const parseBtn = document.getElementById('xhs-parse-btn');
    const linkInput = document.getElementById('xhs-link-input');
    const resultContainer = document.getElementById('xhs-result-container');
    const resultContent = document.getElementById('xhs-result-content');
    const loadingEl = document.getElementById('xhs-loading');
    
    if (!entryBtn || !modal) return;
    
    entryBtn.addEventListener('click', () => {
        hideModal(DOMElements.advancedModal.modal);
        resetXhsModal();
        showModal(modal);
    });
    
    closeBtn.addEventListener('click', () => hideModal(modal));
    
    // 支持回车解析
    linkInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') parseBtn.click();
    });
    
    parseBtn.addEventListener('click', async () => {
        const url = linkInput.value.trim();
        if (!url) {
            showNotification('请输入小红书分享链接', 'warning');
            return;
        }
        
        // 简单验证链接格式
        if (!url.includes('xhslink.com') && !url.includes('xiaohongshu.com')) {
            showNotification('请输入有效的小红书链接', 'warning');
            return;
        }
        
        resultContainer.style.display = 'block';
        loadingEl.style.display = 'block';
        resultContent.innerHTML = '';
        resultContent.appendChild(loadingEl);
        
        try {
            const data = await parseXhsLink(url);
            loadingEl.style.display = 'none';
            currentXhsData = data;
            renderXhsResult(data);
        } catch (error) {
            loadingEl.style.display = 'none';
            resultContent.innerHTML = `
                <div class="xhs-error">
                    <i class="fas fa-exclamation-circle"></i>
                    <p>解析失败</p>
                    <p style="font-size:12px;opacity:0.7;">${error.message || '请检查链接是否正确'}</p>
                </div>
            `;
            showNotification('解析失败，请重试', 'error');
        }
    });
}

function resetXhsModal() {
    const resultContainer = document.getElementById('xhs-result-container');
    const linkInput = document.getElementById('xhs-link-input');
    if (resultContainer) resultContainer.style.display = 'none';
    if (linkInput) linkInput.value = '';
    currentXhsData = null;
}

async function parseXhsLink(url) {
    const apiUrl = 'https://api.bugpk.com/api/xhsjx';
    const targetUrl = `${apiUrl}?url=${encodeURIComponent(url)}`;

    // 先尝试直连，失败再走 CORS 代理
    let data;
    try {
        const resp = await fetch(targetUrl, { signal: AbortSignal.timeout(6000) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        data = await resp.json();
    } catch (directErr) {
        console.warn('直连失败，尝试 CORS 代理:', directErr.message);
        try {
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
            const proxyResp = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
            if (!proxyResp.ok) throw new Error(`代理 HTTP ${proxyResp.status}`);
            const proxyData = await proxyResp.json();
            data = JSON.parse(proxyData.contents);
        } catch (proxyErr) {
            console.error('代理也失败:', proxyErr.message);
            throw new Error('网络请求失败，请检查链接或稍后重试');
        }
    }

    // 兼容多种 API 响应格式
    const ok = data.code === 200 || data.code === '200' || data.success === true || data.status === 200;
    if (!ok) {
        throw new Error(data.msg || data.message || data.error || '解析失败，请确认链接有效');
    }

    const d = data.data || data;
    return {
        title:    d.title    || '小红书笔记',
        desc:     d.desc     || d.content || d.text || '',
        author: {
            name:   d.author?.name   || d.author?.nickname || d.author || '小红书用户',
            avatar: d.author?.avatar || d.author?.headimg  || d.avatar || ''
        },
        media:    d.images   || d.imgs || d.picList || [],
        video:    d.video    || d.videoUrl || null,
        likes:    d.likes    || d.likeCount  || 0,
        comments: d.comments || d.commentCount || 0,
        collects: d.collects || d.collectCount || 0,
        time:     d.time     || d.createTime || '',
        raw: data
    };
}

function renderXhsResult(data) {
    const resultContent = document.getElementById('xhs-result-content');
    
    // 作者信息
    const authorHtml = `
        <div class="xhs-author">
            ${data.author.avatar ? `
                <div class="xhs-author-avatar">
                    <img src="${data.author.avatar}" alt="${data.author.name}" style="width:100%;height:100%;object-fit:cover;">
                </div>
            ` : ''}
            <div class="xhs-author-info">
                <span class="xhs-author-name">${data.author.name}</span>
                ${data.time ? `<span class="xhs-time">${data.time}</span>` : ''}
            </div>
        </div>
    `;
    
    // 标题
    const titleHtml = data.title ? `<div class="xhs-title">${data.title}</div>` : '';
    
    // 媒体内容（图片/视频）
    let mediaHtml = '';
    if (data.video) {
        mediaHtml = `
            <div class="xhs-media-grid">
                <div class="xhs-media-item" onclick="viewImage('${data.video}')">
                    <video src="${data.video}" controls style="width:100%;height:100%;object-fit:cover;"></video>
                </div>
            </div>
        `;
    } else if (data.media && data.media.length > 0) {
        mediaHtml = `
            <div class="xhs-media-grid">
                ${data.media.map(img => `
                    <div class="xhs-media-item" onclick="viewImage('${img}')">
                        <img src="${img}" alt="图片" loading="lazy">
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    // 描述
    const descHtml = data.desc ? `<div class="xhs-desc">${data.desc}</div>` : '';
    
    // 统计数据
    const statsHtml = `
        <div class="xhs-stats">
            ${data.likes ? `<span><i class="fas fa-heart"></i> ${formatNumber(data.likes)}</span>` : ''}
            ${data.comments ? `<span><i class="fas fa-comment"></i> ${formatNumber(data.comments)}</span>` : ''}
            ${data.collects ? `<span><i class="fas fa-star"></i> ${formatNumber(data.collects)}</span>` : ''}
        </div>
    `;
    
    // 发送按钮
    const sendBtnHtml = `
        <button class="xhs-send-btn" onclick="sendXhsToChat()">
            <i class="fas fa-paper-plane"></i> 发送到聊天
        </button>
    `;
    
    resultContent.innerHTML = authorHtml + titleHtml + mediaHtml + descHtml + statsHtml + sendBtnHtml;
}

function formatNumber(num) {
    if (num >= 10000) {
        return (num / 10000).toFixed(1) + 'w';
    }
    return num.toString();
}

function sendXhsToChat() {
    if (!currentXhsData) return;
    
    const data = currentXhsData;
    
    // 构建小红书风格的卡片HTML
    const cardHtml = buildXhsCardHtml(data);
    
    // 发送卡片消息
    addMessage({
        id: Date.now(),
        sender: 'user',
        text: cardHtml,
        timestamp: new Date(),
        status: 'sent',
        type: 'normal',
        isHtml: true, // 标记为HTML内容
        xhsCard: true  // 标记为小红书卡片
    });
    
    playSound('send');
    
    // 关闭模态框
    hideModal(document.getElementById('xhs-parser-modal'));
    showNotification('已发送到聊天', 'success');
}

function buildXhsCardHtml(data) {
    // 构建图片轮播HTML
    const imagesHtml = data.media && data.media.length > 0 
        ? buildImageSlider(data.media) 
        : (data.video ? buildVideoPlayer(data.video) : '');
    
    return `
        <div class="xhs-share-card">
            <!-- 博主信息 -->
            <div class="xhs-card-header">
                <div class="xhs-card-avatar">
                    ${data.author.avatar 
                        ? `<img src="${data.author.avatar}" alt="${data.author.name}">` 
                        : `<i class="fas fa-user"></i>`
                    }
                </div>
                <div class="xhs-card-author-info">
                    <span class="xhs-card-author-name">${escapeHtml(data.author.name || '小红书用户')}</span>
                    <span class="xhs-card-badge">小红书</span>
                </div>
            </div>
            
            <!-- 图片/视频区域 -->
            ${imagesHtml}
            
            <!-- 标题 -->
            <div class="xhs-card-title">${escapeHtml(data.title || '')}</div>
            
            <!-- 内容描述 -->
            <div class="xhs-card-desc">${escapeHtml(data.desc || '').replace(/\n/g, '<br>')}</div>
            
            <!-- 底部来源标识 -->
            <div class="xhs-card-footer">
                <span class="xhs-card-source">🔗 来自小红书</span>
            </div>
        </div>
    `;
}

function buildImageSlider(images) {
    if (images.length === 0) return '';
    
    // 单张图片
    if (images.length === 1) {
        return `
            <div class="xhs-card-media xhs-card-single">
                <img src="${images[0]}" alt="笔记图片" onclick="viewImage('${images[0]}')">
                <div class="xhs-card-image-badge">
                    <i class="fas fa-image"></i>
                </div>
            </div>
        `;
    }
    
    // 多张图片 - 横向滑动
    const imageItems = images.map((img, index) => `
        <div class="xhs-card-slide-item" onclick="viewImage('${img}')">
            <img src="${img}" alt="图片${index + 1}" loading="lazy">
        </div>
    `).join('');
    
    return `
        <div class="xhs-card-media xhs-card-slider">
            <div class="xhs-card-slider-container">
                ${imageItems}
            </div>
            <div class="xhs-card-slider-indicator">
                <span class="xhs-card-image-count">
                    <i class="fas fa-image"></i> 1/${images.length}
                </span>
                <div class="xhs-card-slider-dots">
                    ${images.map((_, i) => `<span class="xhs-card-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></span>`).join('')}
                </div>
            </div>
        </div>
    `;
}

function buildVideoPlayer(videoUrl) {
    return `
        <div class="xhs-card-media xhs-card-video">
            <video src="${videoUrl}" poster="" controls preload="metadata">
                您的浏览器不支持视频播放
            </video>
            <div class="xhs-card-video-badge">
                <i class="fas fa-play"></i>
            </div>
        </div>
    `;
}

// HTML转义函数
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 脚本在页面底部加载，直接执行
setTimeout(() => { initXhsParser(); initWebEmbed(); }, 500);
(function _unused() {
});
// 网页嵌入功能
let currentEmbedUrl = '';
let currentEmbedValid = false;

function initWebEmbed() {
    const entryBtn = document.getElementById('web-embed-function');
    const modal = document.getElementById('web-embed-modal');
    const closeBtn = document.getElementById('close-web-embed');
    const previewBtn = document.getElementById('web-embed-btn');
    const sendBtn = document.getElementById('send-web-embed');
    const urlInput = document.getElementById('web-embed-input');
    const previewContainer = document.getElementById('web-embed-preview');
    const previewContent = document.getElementById('web-embed-preview-content');
    
    if (!entryBtn || !modal) return;
    
    entryBtn.addEventListener('click', () => {
        if (DOMElements.advancedModal && DOMElements.advancedModal.modal) {
            hideModal(DOMElements.advancedModal.modal);
        }
        resetWebEmbed();
        showModal(modal);
        setTimeout(() => urlInput.focus(), 100);
    });
    
    closeBtn.addEventListener('click', () => hideModal(modal));
    
    // 输入时清空预览
    urlInput.addEventListener('input', () => {
        previewContainer.style.display = 'none';
        sendBtn.disabled = true;
        currentEmbedValid = false;
    });
    
    // 回车预览
    urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            previewBtn.click();
        }
    });
    
    // 预览按钮
    previewBtn.addEventListener('click', () => {
        let url = urlInput.value.trim();
        if (!url) {
            showNotification('请输入网址', 'warning');
            return;
        }
        
        // 自动补全协议
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
        
        // 验证 URL 格式
        try {
            new URL(url);
        } catch (e) {
            showNotification('无效的网址格式', 'error');
            return;
        }
        
        currentEmbedUrl = url;
        
        // 显示加载状态
        previewContainer.style.display = 'block';
        previewContent.innerHTML = `
            <div class="web-embed-loading">
                <div class="spinner"></div>
                <span>加载预览中...</span>
            </div>
        `;
        
        // 检测网站是否可嵌入
        checkIfEmbeddable(url).then(canEmbed => {
            currentEmbedValid = true;
            sendBtn.disabled = false;
            
            // 渲染预览
            const cardHtml = buildWebEmbedCard(url, canEmbed, true);
            previewContent.innerHTML = cardHtml;
            
            // 如果是可嵌入的，绑定 iframe 加载事件
            if (canEmbed) {
                const iframe = previewContent.querySelector('iframe');
                if (iframe) {
                    iframe.addEventListener('load', () => {
                        // iframe 加载完成
                    });
                    iframe.addEventListener('error', () => {
                        // 如果 iframe 加载失败，切换为不可嵌入模式
                        const newCard = buildWebEmbedCard(url, false, true);
                        previewContent.innerHTML = newCard;
                    });
                }
            }
        }).catch(() => {
            // 检测失败，默认为可嵌入（让 iframe 自己处理）
            currentEmbedValid = true;
            sendBtn.disabled = false;
            const cardHtml = buildWebEmbedCard(url, true, true);
            previewContent.innerHTML = cardHtml;
        });
    });
    
    // 发送按钮
    sendBtn.addEventListener('click', () => {
        if (!currentEmbedUrl || !currentEmbedValid) {
            showNotification('请先预览网页', 'warning');
            return;
        }
        
        // 构建卡片 HTML
        const cardHtml = buildWebEmbedCard(currentEmbedUrl, true, false);
        
        // 发送消息
        addMessage({
            id: Date.now(),
            sender: 'user',
            text: cardHtml,
            timestamp: new Date(),
            status: 'sent',
            type: 'normal',
            webEmbed: true,
            embedUrl: currentEmbedUrl
        });
        
        playSound('send');
        hideModal(modal);
        showNotification('已发送到聊天', 'success');
    });
}

function resetWebEmbed() {
    const urlInput = document.getElementById('web-embed-input');
    const previewContainer = document.getElementById('web-embed-preview');
    const sendBtn = document.getElementById('send-web-embed');
    
    if (urlInput) urlInput.value = '';
    if (previewContainer) previewContainer.style.display = 'none';
    if (sendBtn) sendBtn.disabled = true;
    
    currentEmbedUrl = '';
    currentEmbedValid = false;
}

// 检测 URL 是否可嵌入（通过发送 HEAD 请求检查 X-Frame-Options）
async function checkIfEmbeddable(url) {
    try {
        // 使用 CORS 代理发送请求
        const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
        const response = await fetch(proxyUrl, { method: 'HEAD' });
        
        // 检查 X-Frame-Options 头
        const frameOptions = response.headers.get('X-Frame-Options');
        if (frameOptions) {
            const lower = frameOptions.toLowerCase();
            if (lower === 'deny' || lower === 'sameorigin') {
                return false;
            }
        }
        
        // 检查 CSP 头中的 frame-ancestors
        const csp = response.headers.get('Content-Security-Policy');
        if (csp && csp.includes('frame-ancestors')) {
            // 如果有限制，大概率不能嵌入
            if (csp.includes("frame-ancestors 'none'") || csp.includes("frame-ancestors 'self'")) {
                return false;
            }
        }
        
        return true;
    } catch (e) {
        console.warn('检测嵌入性失败:', e);
        return true; // 默认认为可以嵌入
    }
}

// 构建网页嵌入卡片 HTML
function buildWebEmbedCard(url, attemptEmbed = true, isPreview = false) {
    let domain = '';
    try {
        domain = new URL(url).hostname.replace('www.', '');
    } catch (e) {
        domain = url;
    }
    
    const escapedUrl = escapeHtml(url);
    const escapedDomain = escapeHtml(domain);
    
    // 如果尝试嵌入，使用 iframe
    if (attemptEmbed) {
        // 使用 sandbox 属性提高安全性，同时允许必要的功能
        const sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox';
        
        return `
            <div class="web-embed-card" data-embed-url="${escapedUrl}">
                <div class="web-embed-header">
                    <div class="web-embed-url">
                        <i class="fas fa-globe"></i>
                        <span title="${escapedUrl}">${escapedDomain}</span>
                    </div>
                    <div class="web-embed-actions">
                        <button class="web-embed-btn-icon" onclick="window.open('${escapedUrl}', '_blank')" title="在浏览器中打开">
                            <i class="fas fa-external-link-alt"></i>
                        </button>
                        ${isPreview ? '' : `
                        <button class="web-embed-btn-icon" onclick="this.closest('.web-embed-card').querySelector('.web-embed-content').style.display='none';this.closest('.web-embed-card').querySelector('.web-embed-blocked-fallback').style.display='flex'" title="收起">
                            <i class="fas fa-chevron-up"></i>
                        </button>
                        `}
                    </div>
                </div>
                <div class="web-embed-content">
                    <iframe src="${escapedUrl}" 
                            sandbox="${sandbox}"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            loading="lazy"
                            onerror="this.style.display='none'; this.parentElement.querySelector('.web-embed-blocked-fallback').style.display='flex'">
                    </iframe>
                </div>
                <div class="web-embed-blocked-fallback" style="display: none;">
                    <div class="web-embed-blocked">
                        <i class="fas fa-globe"></i>
                        <p>此网页无法在应用内显示</p>
                        <div class="web-embed-domain">${escapedDomain}</div>
                        <button class="web-embed-open-btn" onclick="window.open('${escapedUrl}', '_blank')">
                            <i class="fas fa-external-link-alt"></i> 在浏览器中打开
                        </button>
                    </div>
                </div>
            </div>
        `;
    } else {
        // 直接显示"无法嵌入"状态
        return `
            <div class="web-embed-card" data-embed-url="${escapedUrl}">
                <div class="web-embed-header">
                    <div class="web-embed-url">
                        <i class="fas fa-globe"></i>
                        <span title="${escapedUrl}">${escapedDomain}</span>
                    </div>
                    <div class="web-embed-actions">
                        <button class="web-embed-btn-icon" onclick="window.open('${escapedUrl}', '_blank')" title="在浏览器中打开">
                            <i class="fas fa-external-link-alt"></i>
                        </button>
                    </div>
                </div>
                <div class="web-embed-blocked">
                    <i class="fas fa-lock"></i>
                    <p>出于安全原因，此网页无法嵌入显示</p>
                    <div class="web-embed-domain">${escapedDomain}</div>
                    <button class="web-embed-open-btn" onclick="window.open('${escapedUrl}', '_blank')">
                        <i class="fas fa-external-link-alt"></i> 在浏览器中打开
                    </button>
                </div>
            </div>
        `;
    }
}

// HTML 转义
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}