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
        const rawInput = linkInput.value.trim();
        if (!rawInput) {
            showNotification('请输入小红书分享链接', 'warning');
            return;
        }
        
        // 从完整分享文本中提取链接（支持：纯链接 / 带前后文字的分享文本）
        let url = rawInput;
        if (!rawInput.startsWith('http')) {
            const urlMatch = rawInput.match(/https?:\/\/[^\s，,。！!？?\u3000\u300c\u300d\uff08\uff09\u300a\u300b\u3010\u3011]+/);
            if (urlMatch) {
                url = urlMatch[0];
                // 去掉链接末尾可能跟着的中文标点
                url = url.replace(/[。，、！？：；…—～·「」『』【】《》〈〉""'']+$/, '');
                showNotification('已自动提取链接 ✓', 'success', 1500);
            }
        }
        
        // 验证链接格式
        if (!url.includes('xhslink.com') && !url.includes('xiaohongshu.com')) {
            showNotification('未找到有效的小红书链接，请检查后重试', 'warning');
            return;
        }
        
        // 将提取到的干净链接回填到输入框
        linkInput.value = url;
        
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
            const errMsg = error.message || '请检查链接是否正确';
            const isNetworkErr = errMsg.includes('网络') || errMsg.includes('API') || errMsg.includes('timeout');
            resultContent.innerHTML = `
                <div class="xhs-error">
                    <i class="fas fa-exclamation-circle"></i>
                    <p>解析失败</p>
                    <p style="font-size:12px;opacity:0.7;">${errMsg}</p>
                    ${isNetworkErr ? `<p style="font-size:11px;opacity:0.5;margin-top:4px;">解析服务暂时不稳定，可稍等片刻后重试</p>` : ''}
                    <button class="xhs-send-btn" style="margin-top:12px;padding:8px 16px;font-size:13px;"
                            onclick="document.getElementById('xhs-parse-btn').click()">
                        <i class="fas fa-redo"></i> 重新解析
                    </button>
                </div>
            `;
            showNotification('解析失败，请稍后重试', 'error');
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
    // 多 API 端点，依次尝试
    const apiEndpoints = [
        'https://api.bugpk.com/api/xhsjx',
        'https://api.douyin.wtf/api/xhs_video',
        'https://xhsapi.netlify.app/api/parse',
    ];

    // 多 CORS 代理，依次尝试
    const corsProxies = [
        (u) => ({ url: `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`, extract: (d) => JSON.parse(d.contents) }),
        (u) => ({ url: `https://corsproxy.io/?${encodeURIComponent(u)}`, extract: (d) => d }),
        (u) => ({ url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`, extract: (d) => d }),
        (u) => ({ url: `https://proxy.cors.sh/${u}`, extract: (d) => d }),
    ];

    // 尝试直连某个端点
    async function tryDirect(targetUrl) {
        const resp = await fetch(targetUrl, { signal: AbortSignal.timeout(6000) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    }

    // 尝试经某个代理访问某个端点
    async function tryProxy(proxy, targetUrl) {
        const { url: proxyUrl, extract } = proxy(targetUrl);
        const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
        if (!resp.ok) throw new Error(`代理 HTTP ${resp.status}`);
        const raw = await resp.json();
        return extract(raw);
    }

    // 规范化 API 响应
    function normalize(data) {
        const ok = data.code === 200 || data.code === '200' ||
                   data.success === true || data.status === 200 ||
                   (data.data && Object.keys(data.data).length > 0);
        if (!ok) throw new Error(data.msg || data.message || data.error || '解析失败，请确认链接有效');
        const d = data.data || data;
        return {
            title:    d.title    || '小红书笔记',
            desc:     d.desc     || d.content || d.text || d.note_text || '',
            author: {
                name:   d.author?.name   || d.author?.nickname || d.nickname || d.author || '小红书用户',
                avatar: d.author?.avatar || d.author?.headimg  || d.headimg  || d.avatar || ''
            },
            media:    d.images   || d.imgs || d.picList || d.image_list || [],
            video:    d.video    || d.videoUrl || d.video_url || null,
            likes:    d.likes    || d.likeCount  || d.like_count  || 0,
            comments: d.comments || d.commentCount || d.comment_count || 0,
            collects: d.collects || d.collectCount || d.collect_count || 0,
            time:     d.time     || d.createTime || d.create_time || '',
            raw: data
        };
    }

    const errors = [];

    for (const api of apiEndpoints) {
        const targetUrl = `${api}?url=${encodeURIComponent(url)}`;

        // 1. 直连尝试
        try {
            const data = await tryDirect(targetUrl);
            return normalize(data);
        } catch (e) {
            console.warn(`直连 ${api} 失败:`, e.message);
        }

        // 2. 逐个代理尝试
        for (const proxy of corsProxies) {
            try {
                const data = await tryProxy(proxy, targetUrl);
                return normalize(data);
            } catch (e) {
                errors.push(e.message);
                console.warn(`代理失败 (${api}):`, e.message);
            }
        }
    }

    console.error('所有解析方案均失败，错误汇总:', errors);
    throw new Error('网络请求失败，API 服务暂时不可用，请稍后重试');
}

// 图片代理 —— 绕过小红书 CDN 防盗链
function proxyImageUrl(url) {
    if (!url) return url;
    if (!url.startsWith('http')) return url;
    // 已经走代理的跳过
    if (url.includes('wsrv.nl') || url.includes('weserv.nl') || url.includes('imageproxy')) return url;
    // 所有 XHS 图片都走 wsrv.nl 代理（免费、无鉴权、支持防盗链穿透）
    return `https://wsrv.nl/?url=${encodeURIComponent(url)}&output=webp&maxage=7d`;
}

function renderXhsResult(data) {
    const resultContent = document.getElementById('xhs-result-content');
    
    // 作者信息
    const authorHtml = `
        <div class="xhs-author">
            ${data.author.avatar ? `
                <div class="xhs-author-avatar">
                    <img src="${proxyImageUrl(data.author.avatar)}" alt="${data.author.name}" style="width:100%;height:100%;object-fit:cover;"
                         onerror="this.style.display='none'">
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
                <div class="xhs-media-item" onclick="viewImage('${proxyImageUrl(data.video)}')">
                    <video src="${proxyImageUrl(data.video)}" controls style="width:100%;height:100%;object-fit:cover;"></video>
                </div>
            </div>
        `;
    } else if (data.media && data.media.length > 0) {
        mediaHtml = `
            <div class="xhs-media-grid">
                ${data.media.map(img => `
                    <div class="xhs-media-item" onclick="viewImage('${proxyImageUrl(img)}')">
                        <img src="${proxyImageUrl(img)}" alt="图片" loading="lazy"
                             onerror="this.style.opacity='0.3'">
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
        isHtml: true,
        xhsCard: true
    });
    
    playSound('send');
    
    // 触发「对方已读」
    if (typeof window.scheduleReadReceipt === 'function') window.scheduleReadReceipt();
    
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
                        ? `<img src="${proxyImageUrl(data.author.avatar)}" alt="${data.author.name}" onerror="this.style.display='none'">` 
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
        const proxied = proxyImageUrl(images[0]);
        return `
            <div class="xhs-card-media xhs-card-single">
                <img src="${proxied}" alt="笔记图片" onclick="viewImage('${proxied}')"
                     onerror="this.style.opacity='0.2'">
                <div class="xhs-card-image-badge">
                    <i class="fas fa-image"></i>
                </div>
            </div>
        `;
    }
    
    // 多张图片 - 横向滑动
    const imageItems = images.map((img, index) => {
        const proxied = proxyImageUrl(img);
        return `
            <div class="xhs-card-slide-item" onclick="viewImage('${proxied}')">
                <img src="${proxied}" alt="图片${index + 1}" loading="lazy"
                     onerror="this.style.opacity='0.2'">
            </div>
        `;
    }).join('');
    
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
        // 触发「对方已读」
        if (typeof window.scheduleReadReceipt === 'function') window.scheduleReadReceipt();
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

// 检测 URL 是否可嵌入（通过多代理检查 X-Frame-Options 安全头）
async function checkIfEmbeddable(url) {
    // 已知无法 iframe 嵌入的域名黑名单
    const blockedDomains = [
        'google.com', 'youtube.com', 'twitter.com', 'x.com',
        'facebook.com', 'instagram.com', 'linkedin.com',
        'xiaohongshu.com', 'xhslink.com', 'taobao.com',
        'jd.com', 'weibo.com', 'zhihu.com', 'baidu.com',
        'douyin.com', 'tiktok.com',
    ];
    try {
        const hostname = new URL(url).hostname.replace('www.', '');
        if (blockedDomains.some(d => hostname.includes(d))) return false;
    } catch (e) { /* ignore invalid URL */ }

    // 尝试多个 CORS 代理获取响应头
    const proxyUrls = [
        'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
        'https://corsproxy.io/?' + encodeURIComponent(url),
    ];

    for (const proxyUrl of proxyUrls) {
        try {
            const response = await fetch(proxyUrl, {
                method: 'GET',
                signal: AbortSignal.timeout(6000)
            });

            const frameOptions = response.headers.get('X-Frame-Options');
            if (frameOptions) {
                const lower = frameOptions.toLowerCase();
                if (lower === 'deny' || lower === 'sameorigin') return false;
            }

            const csp = response.headers.get('Content-Security-Policy');
            if (csp && csp.includes('frame-ancestors')) {
                if (csp.includes("frame-ancestors 'none'") || csp.includes("frame-ancestors 'self'")) {
                    return false;
                }
            }
            return true;
        } catch (e) {
            console.warn('嵌入检测代理失败:', e.message);
        }
    }
    return true; // 代理均失败，乐观假设可嵌入
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

// escapeHtml 已在上方定义，此处不再重复声明