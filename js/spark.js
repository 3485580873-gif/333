/**
 * 四叶草功能 - Clover Streak
 * 用四叶草叶片数量表示连续聊天的阶段：
 *   1 片 (1–60天)   2 片 (61–120天)
 *   3 片 (121–180天)  4 片 (181天+)
 */
(function() {
  'use strict';

  const STORAGE_KEY = 'chat_streak_data';
  const STREAK_THRESHOLD = 3;   // 出现图标所需连续天数
  const REKINDLE_THRESHOLD = 3; // 重燃所需连续天数

  // 四叶草阶段定义
  const CLOVER_STAGES = [
    { min: 1,   max: 60,  leaves: 1, label: '初芽', color: '#a8d8a8', glow: 'rgba(168,216,168,0.5)', desc: '第一片叶子悄悄长出来了 🌱' },
    { min: 61,  max: 120, leaves: 2, label: '生长', color: '#5cb85c', glow: 'rgba(92,184,92,0.5)',   desc: '两片叶子，正在茁壮成长 🍃' },
    { min: 121, max: 180, leaves: 3, label: '繁茂', color: '#3a9d3a', glow: 'rgba(58,157,58,0.5)',   desc: '三片叶子，彼此相伴更坚定 🌿' },
    { min: 181, max: Infinity, leaves: 4, label: '幸运', color: '#2d7d2d', glow: 'rgba(45,125,45,0.55)', desc: '四叶草盛开，你们是彼此的幸运 🍀' }
  ];

  // 四叶草 SVG 生成（按叶片数渲染）
  function cloverSVG(leaves, size, color, animate) {
    size = size || 28;
    color = color || '#5cb85c';
    // 四片叶子的路径（以圆心为原点，各朝四个方向）
    const r = size * 0.32;
    const cx = size / 2, cy = size / 2;
    const leafPaths = [
      // 上叶
      `<ellipse cx="${cx}" cy="${cy - r}" rx="${r*0.58}" ry="${r}" fill="${color}" opacity="${leaves >= 1 ? 1 : 0.12}" transform="rotate(-10,${cx},${cy})"/>`,
      // 右叶
      `<ellipse cx="${cx + r}" cy="${cy}" rx="${r}" ry="${r*0.58}" fill="${color}" opacity="${leaves >= 2 ? 1 : 0.12}" transform="rotate(10,${cx},${cy})"/>`,
      // 下叶
      `<ellipse cx="${cx}" cy="${cy + r}" rx="${r*0.58}" ry="${r}" fill="${color}" opacity="${leaves >= 3 ? 1 : 0.12}" transform="rotate(10,${cx},${cy})"/>`,
      // 左叶
      `<ellipse cx="${cx - r}" cy="${cy}" rx="${r}" ry="${r*0.58}" fill="${color}" opacity="${leaves >= 4 ? 1 : 0.12}" transform="rotate(-10,${cx},${cy})"/>`,
    ];
    // 茎
    const stem = `<path d="M${cx} ${cy+r*0.2} Q${cx+r*0.5} ${cy+r*1.4} ${cx+r*0.8} ${cy+r*1.8}" stroke="${color}" stroke-width="${size*0.045}" fill="none" stroke-linecap="round" opacity="0.7"/>`;
    const anim = animate ? `<animateTransform attributeName="transform" type="rotate" from="-3 ${cx} ${cy}" to="3 ${cx} ${cy}" dur="2.5s" repeatCount="indefinite" additive="sum"/>` : '';
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">${anim ? '<g>' : ''}${leafPaths.join('')}${stem}${anim ? anim + '</g>' : ''}</svg>`;
  }

  // 大号展示用 SVG（弹窗顶部）
  function cloverSVGLarge(leaves, color) {
    return cloverSVG(76, 76, color, true);
  }

  let streakData = {
    currentStreak: 0,
    maxStreak: 0,
    rekindleCount: 0,
    lastChatDate: null,
    isActive: false,
    rekindleProgress: 0,
    history: []
  };

  function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function getDateDiff(date1, date2) {
    const d1 = new Date(date1 + 'T00:00:00');
    const d2 = new Date(date2 + 'T00:00:00');
    return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
  }

  function getStage(days) {
    for (let s of CLOVER_STAGES) {
      if (days >= s.min && days <= s.max) return s;
    }
    return CLOVER_STAGES[3];
  }

  function loadStreakData() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) streakData = { ...streakData, ...JSON.parse(saved) };
    } catch(e) {}
  }

  function saveStreakData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(streakData));
    } catch(e) {}
  }

  // ========== 核心逻辑 ==========
  function recordChat() {
    const today = getTodayStr();
    if (streakData.lastChatDate === today) return;

    const diff = streakData.lastChatDate ? getDateDiff(streakData.lastChatDate, today) : 999;

    if (diff === 1) {
      streakData.currentStreak++;
      streakData.rekindleProgress++;

      if (!streakData.isActive && streakData.currentStreak >= STREAK_THRESHOLD) {
        streakData.isActive = true;
        streakData.rekindleProgress = 0;
        const stage = getStage(streakData.currentStreak);
        showSparkNotification('🍀 四叶草出现！已连续聊天 ' + streakData.currentStreak + ' 天');
      } else if (!streakData.isActive && streakData.rekindleProgress >= REKINDLE_THRESHOLD) {
        streakData.isActive = true;
        streakData.currentStreak = streakData.rekindleProgress;
        streakData.rekindleCount++;
        streakData.rekindleProgress = 0;
        showSparkNotification('🍀 四叶草重燃！连续聊天 ' + streakData.currentStreak + ' 天');
      } else if (streakData.isActive) {
        if (streakData.currentStreak > streakData.maxStreak) {
          streakData.maxStreak = streakData.currentStreak;
        }
        // 阶段升级通知
        const stage = getStage(streakData.currentStreak);
        const prevStage = getStage(streakData.currentStreak - 1);
        if (stage.leaves > prevStage.leaves) {
          showSparkNotification('🍀 四叶草长出第 ' + stage.leaves + ' 片叶子！' + stage.label);
        }
      }
    } else if (diff > 1) {
      if (streakData.isActive) {
        streakData.isActive = false;
        streakData.rekindleProgress = 0;
        showSparkNotification('🍂 四叶草暂时枯萎了，连续聊天可重燃');
      }
      streakData.currentStreak = 1;
      streakData.rekindleProgress = 1;
    } else {
      return;
    }

    streakData.lastChatDate = today;
    saveStreakData();
    updateSparkUI();
  }

  function recordPartnerChat() {}

  // ========== UI 更新 ==========
  function updateSparkUI() {
    const icon = document.getElementById('spark-icon');
    const badge = document.getElementById('spark-badge');
    const flameEl = icon ? icon.querySelector('.spark-flame') : null;
    if (!icon) return;

    const days = streakData.currentStreak;
    const stage = getStage(Math.max(days, 1));

    if (streakData.isActive) {
      icon.className = 'spark-icon active';
      icon.style.display = 'flex';
      if (flameEl) flameEl.innerHTML = cloverSVG(stage.leaves, 22, stage.color, false);
      if (badge) {
        badge.textContent = days;
        badge.style.background = `linear-gradient(135deg, ${stage.color}, ${stage.color}cc)`;
        badge.style.display = 'block';
      }
    } else if (streakData.currentStreak > 0 || streakData.rekindleProgress > 0) {
      icon.className = 'spark-icon inactive';
      icon.style.display = 'flex';
      if (flameEl) flameEl.innerHTML = cloverSVG(1, 22, '#aaa', false);
      if (badge) {
        const d = streakData.rekindleProgress || streakData.currentStreak;
        badge.textContent = d;
        badge.style.background = 'linear-gradient(135deg, #aaa, #888)';
        badge.style.display = d > 0 ? 'block' : 'none';
      }
    } else {
      icon.style.display = 'none';
    }
  }

  function showSparkNotification(text) {
    if (typeof showNotification === 'function') showNotification(text, 'info', 3000);
  }

  // ========== 弹窗 ==========
  function openSparkModal() {
    const overlay = document.getElementById('spark-modal-overlay');
    if (!overlay) return;

    const flameEl   = document.getElementById('spark-modal-flame');
    const titleEl   = document.getElementById('spark-modal-title');
    const subtitleEl= document.getElementById('spark-modal-subtitle');
    const daysEl    = document.getElementById('spark-streak-days');
    const rekindleEl= document.getElementById('spark-rekindle-count');
    const infoEl    = document.getElementById('spark-rekindle-info');
    const progressEl= document.getElementById('spark-leaf-progress');
    const maxEl     = document.getElementById('spark-max-streak');

    const days  = streakData.currentStreak;
    const stage = getStage(Math.max(days, 1));

    if (streakData.isActive) {
      if (flameEl) flameEl.innerHTML = cloverSVG(stage.leaves, 76, stage.color, true);
      titleEl.textContent  = '🍀 ' + stage.label + ' · 第 ' + stage.leaves + ' 片叶子';
      subtitleEl.textContent = stage.desc;
      if (infoEl) {
        infoEl.className = 'spark-rekindle-info';
        infoEl.querySelector('.rekindle-text').textContent = '✨ 四叶草状态良好';
        infoEl.querySelector('.rekindle-sub').textContent  = '继续保持连续聊天，叶子还会继续长大！';
      }
    } else if (streakData.rekindleProgress > 0) {
      if (flameEl) flameEl.innerHTML = cloverSVG(1, 76, '#aaa', false);
      titleEl.textContent  = '🌱 四叶草正在恢复';
      subtitleEl.textContent = '连续聊天中，四叶草即将重新绽放！';
      if (infoEl) {
        infoEl.className = 'spark-rekindle-info needed';
        const need = REKINDLE_THRESHOLD - streakData.rekindleProgress;
        infoEl.querySelector('.rekindle-text').textContent = '💡 还需连续聊天 ' + need + ' 天';
        infoEl.querySelector('.rekindle-sub').textContent  = '加油，四叶草就要回来了！';
      }
    } else {
      if (flameEl) flameEl.innerHTML = cloverSVG(1, 76, '#ccc', false);
      titleEl.textContent  = '🍂 四叶草暂时枯萎了';
      subtitleEl.textContent = '昨天没有聊天，四叶草变灰了...';
      if (infoEl) {
        infoEl.className = 'spark-rekindle-info needed';
        infoEl.querySelector('.rekindle-text').textContent = '💡 还需连续聊天 ' + REKINDLE_THRESHOLD + ' 天';
        infoEl.querySelector('.rekindle-sub').textContent  = '重新出发，让四叶草再次绽放吧！';
      }
    }

    if (daysEl) daysEl.textContent = days;
    if (rekindleEl) rekindleEl.textContent = streakData.rekindleCount;
    if (maxEl) maxEl.textContent = Math.max(streakData.maxStreak, days);

    // 四片叶子进度展示
    if (progressEl) {
      progressEl.innerHTML = CLOVER_STAGES.map(s => {
        const reached = streakData.isActive && days >= s.min;
        const isCurrent = streakData.isActive && days >= s.min && days <= s.max;
        return `<div class="leaf-stage ${reached ? 'reached' : ''} ${isCurrent ? 'current' : ''}">
          <div class="leaf-stage-icon">${cloverSVG(s.leaves, 32, reached ? s.color : '#ddd', false)}</div>
          <div class="leaf-stage-days">${s.min}${s.max === Infinity ? '+' : ('–' + s.max)} 天</div>
          <div class="leaf-stage-label">${s.label}</div>
        </div>`;
      }).join('');
    }

    overlay.style.display = 'flex';
    overlay.style.opacity = '1';
    overlay.style.visibility = 'visible';
  }

  function closeSparkModal() {
    const overlay = document.getElementById('spark-modal-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.style.opacity = '0';
      overlay.style.visibility = 'hidden';
    }
  }

  function init() {
    var overlay = document.getElementById('spark-modal-overlay');
    if (overlay && overlay.parentElement && overlay.parentElement.tagName !== 'BODY') {
      document.body.appendChild(overlay);
    }
    loadStreakData();
    updateSparkUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.SparkApp = {
    recordChat, recordPartnerChat,
    openSparkModal, closeSparkModal,
    getData: () => ({ ...streakData })
  };
})();
