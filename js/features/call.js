(function () {
    'use strict';

    const KEY_ENABLED  = 'callFeatureEnabled';
    const KEY_POS      = 'callWindowPos';
    const KEY_SIZE     = 'callWindowSize';
    const KEY_PILL_POS = 'callPillPos';
    const BG_LF_KEY    = 'callBgImageData';
    const KEY_SESSION  = 'callInterruptedSession';      // 中断通话恢复
    const SESSION_MAX_AGE = 24 * 60 * 60 * 1000;        // 超过24h的记录视为过期
    const SESSION_MIN_DUR = 3000;                        // 通话不足3秒不提示恢复

    const S = {
        enabled:         localStorage.getItem(KEY_ENABLED) !== 'false',
        active:          false,
        startTime:       null,
        elapsed:         0,
        timerRAF:        null,
        minimized:       false,
        immersive:       false,
        bgImage:         null,
        pos:             JSON.parse(localStorage.getItem(KEY_POS)  || 'null'),
        pillPos:         JSON.parse(localStorage.getItem(KEY_PILL_POS) || 'null'),
        size:            JSON.parse(localStorage.getItem(KEY_SIZE) || '{"w":280,"h":440}'),
        dragOff:         null,
        pillDragOff:     null,
        pillDragged:     false,
        resizeInit:      null,
        incomingTimer:   null,
        connectingTimer: null,
        randomCallTimer: null,
        isPartnerCall:   false,
        lastSessionSave: 0,          // 上次自动保存session的时间戳(防崩溃)
        _pendingResume:  null,       // 待恢复的session数据
    };

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    function loadBg() {
        if (!window.localforage) return;
        localforage.getItem(BG_LF_KEY).then(v => { if (v) { S.bgImage = v; applyBg(); } }).catch(() => {});
    }
    function saveBg(d) {
        if (!d || !window.localforage) return;
        localforage.setItem(BG_LF_KEY, d).catch(() => {});
    }

    const SVG_HU = `<svg viewBox="0 0 24 24" fill="none" style="display:block;width:100%;height:100%;">
  <path d="M6.6 10.8c1.4 2.8 3.7 5.1 6.5 6.5l2.2-2.2c.28-.27.68-.36 1.03-.24 1.1.37 2.3.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.56 21 3 13.44 3 4c0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.28.2 2.5.57 3.57.11.35.03.74-.24 1.02L6.6 10.8z" fill="white"/>
  <line x1="21" y1="3" x2="3" y2="21" stroke="white" stroke-width="2.4" stroke-linecap="round"/>
</svg>`;

    function injectCSS() {
        if (document.getElementById('call-feature-style')) return;
        const el = document.createElement('style');
        el.id = 'call-feature-style';
        el.textContent = `
#call-incoming-overlay{
    position:fixed;inset:0;z-index:99990;
    display:none;align-items:center;justify-content:center;
    background:rgba(0,0,0,.62);
    backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);
}
#call-incoming-overlay.visible{display:flex;animation:cFi .35s ease;}
.call-inc-card{
    width:272px;
    background:linear-gradient(160deg,rgba(255,255,255,.11),rgba(255,255,255,.04));
    border:1px solid rgba(255,255,255,.18);border-radius:32px;
    padding:44px 28px 36px;
    display:flex;flex-direction:column;align-items:center;gap:8px;color:#fff;
    box-shadow:0 32px 80px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.15);
    animation:cCu .45s cubic-bezier(.22,1,.36,1);
    position:relative;overflow:hidden;
}
.call-inc-card::before{
    content:'';position:absolute;inset:0;pointer-events:none;
    background:radial-gradient(ellipse at 50% 0%,rgba(var(--accent-color-rgb,224,105,138),.28),transparent 65%);
}
.call-inc-ring{position:relative;margin-bottom:8px;width:88px;height:88px;}
.call-inc-ring::before,.call-inc-ring::after{
    content:'';position:absolute;
    top:-12px;left:-12px;right:-12px;bottom:-12px;
    border-radius:50%;border:1.5px solid rgba(255,255,255,.18);
    animation:cRp 2.2s ease-in-out infinite;
}
.call-inc-ring::after{
    top:-22px;left:-22px;right:-22px;bottom:-22px;
    border-color:rgba(255,255,255,.08);animation-delay:.65s;
}
.call-inc-avatar{
    position:absolute;inset:0;
    border-radius:50%;background:var(--accent-color,#e0698a);
    display:flex;align-items:center;justify-content:center;overflow:hidden;
    border:2px solid rgba(255,255,255,.25);box-shadow:0 8px 28px rgba(0,0,0,.36);
}
.call-inc-avatar img{width:100%;height:100%;object-fit:cover;}
.call-inc-avatar i{font-size:34px;color:rgba(255,255,255,.85);}
.call-inc-name{font-size:22px;font-weight:700;margin-top:4px;}
.call-inc-sub{font-size:12.5px;color:rgba(255,255,255,.48);display:flex;align-items:center;gap:6px;}
.call-inc-sub-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.48);animation:cBl 1.1s step-end infinite;}
.call-inc-actions{display:flex;gap:44px;margin-top:26px;}
.call-inc-btn{display:flex;flex-direction:column;align-items:center;gap:7px;background:none;border:none;cursor:pointer;color:#fff;}
.call-inc-circle{
    width:64px;height:64px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    transition:transform .18s;padding:16px;
}
.call-inc-btn:hover .call-inc-circle{transform:scale(1.1);}
.call-inc-btn:active .call-inc-circle{transform:scale(.9);}
.call-inc-reject .call-inc-circle{background:linear-gradient(135deg,#ff5252,#c62828);box-shadow:0 6px 20px rgba(255,82,82,.45);}
.call-inc-accept .call-inc-circle{background:linear-gradient(135deg,#4caf50,#2e7d32);box-shadow:0 6px 20px rgba(76,175,80,.45);padding:18px;}
.call-inc-lbl{font-size:12px;color:rgba(255,255,255,.48);font-weight:500;}

#call-window{
    position:fixed;z-index:99900;
    border-radius:22px;overflow:visible;
    display:none;flex-direction:column;
    box-shadow:0 20px 60px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.1);
    user-select:none;touch-action:none;
    min-width:160px;min-height:240px;
    max-width:90vw;max-height:90vh;
}
#call-window.visible{display:flex;animation:cWi .4s cubic-bezier(.22,1,.36,1);}

#call-window-inner{
    border-radius:22px;overflow:hidden;
    flex:1;display:flex;flex-direction:column;position:relative;
}

#call-window-bg{position:absolute;inset:0;z-index:0;}
.call-bg-grad{position:absolute;inset:0;background:linear-gradient(155deg,#0d1b2a 0%,#1b263b 50%,#415a77 100%);}
#call-window-bg img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none;}
.call-orb{position:absolute;border-radius:50%;filter:blur(44px);opacity:.28;animation:cOrb linear infinite;pointer-events:none;}
.call-orb-1{width:130px;height:130px;background:var(--accent-color,#e0698a);top:-25px;left:-25px;animation-duration:18s;}
.call-orb-2{width:90px;height:90px;background:#4a90d9;bottom:10px;right:-10px;animation-duration:23s;animation-delay:-9s;}
.call-orb-3{width:70px;height:70px;background:#9b59b6;top:40%;left:45%;animation-duration:28s;animation-delay:-14s;}
.call-overlay{
    position:absolute;inset:0;z-index:1;transition:opacity .4s;
    background:linear-gradient(to bottom,rgba(0,0,0,.5) 0%,rgba(0,0,0,.04) 35%,rgba(0,0,0,.04) 60%,rgba(0,0,0,.65) 100%);
}

#call-window-header{
    position:relative;z-index:10;
    display:flex;align-items:center;justify-content:space-between;
    padding:12px 12px 6px;cursor:grab;transition:opacity .35s;flex-shrink:0;
}
#call-window-header:active{cursor:grabbing;}
.call-badge{
    display:flex;align-items:center;gap:5px;
    background:rgba(0,0,0,.32);backdrop-filter:blur(8px);
    border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:4px 10px;
}
.call-rec-dot{
    width:6px;height:6px;border-radius:50%;
    background:#4caf50;box-shadow:0 0 6px #4caf50;
    animation:cBl 1.8s ease-in-out infinite alternate;flex-shrink:0;
}
.call-timer-txt{
    font-size:11px;font-weight:700;letter-spacing:.08em;
    color:rgba(255,255,255,.92);font-variant-numeric:tabular-nums;
}
.call-top-btns{display:flex;gap:3px;}
.call-top-btn{
    width:26px;height:26px;border-radius:50%;border:none;
    background:rgba(255,255,255,.12);backdrop-filter:blur(6px);
    color:rgba(255,255,255,.75);cursor:pointer;font-size:10px;
    display:flex;align-items:center;justify-content:center;
    transition:background .2s,transform .15s;
}
.call-top-btn:hover{background:rgba(255,255,255,.22);transform:scale(1.08);}

#call-connecting-state{
    position:relative;z-index:10;
    display:none;flex-direction:column;align-items:center;
    justify-content:center;flex:1;gap:10px;padding:16px 12px;
}
#call-connecting-state.visible{display:flex;}
.call-conn-dots{display:flex;gap:6px;margin-top:4px;}
.call-conn-dots span{
    width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.5);
    animation:cCd .9s ease-in-out infinite;
}
.call-conn-dots span:nth-child(2){animation-delay:.15s;}
.call-conn-dots span:nth-child(3){animation-delay:.3s;}

#call-window-body{
    position:relative;z-index:10;
    flex:1;display:flex;flex-direction:column;
    align-items:center;justify-content:center;
    gap:10px;padding:4px 12px;
}
.call-av-wrap{
    position:relative;
    width:68px;height:68px;  
    flex-shrink:0;
    display:flex;align-items:center;justify-content:center;
}
.call-av-pulse{
    position:absolute;
    top:-10px;left:-10px;right:-10px;bottom:-10px;
    border-radius:50%;
    border:1.5px solid rgba(255,255,255,.22);
    animation:cAp 2.5s ease-in-out infinite;
    pointer-events:none;
}
.call-av-pulse2{
    position:absolute;
    top:-18px;left:-18px;right:-18px;bottom:-18px;
    border-radius:50%;
    border:1px solid rgba(255,255,255,.09);
    animation:cAp 2.5s ease-in-out infinite .65s;
    pointer-events:none;
}
.call-avatar{
    width:68px;height:68px;
    border-radius:50%;
    background:var(--accent-color,#e0698a);
    border:2.5px solid rgba(255,255,255,.28);
    overflow:hidden;
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 6px 22px rgba(0,0,0,.4);
    position:relative;z-index:1;  
    flex-shrink:0;
}
.call-avatar img{width:100%;height:100%;object-fit:cover;}
.call-avatar i{font-size:26px;color:rgba(255,255,255,.82);}

.call-name{
    font-size:16px;font-weight:700;color:#fff;
    text-shadow:0 2px 8px rgba(0,0,0,.5);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    max-width:88%;text-align:center;
}
.call-wave{display:flex;align-items:center;gap:3px;height:18px;}
.call-wave span{width:3px;border-radius:3px;background:rgba(255,255,255,.5);animation:cWv .85s ease-in-out infinite;}
.call-wave span:nth-child(1){height:6px;animation-delay:0s;}
.call-wave span:nth-child(2){height:13px;animation-delay:.1s;}
.call-wave span:nth-child(3){height:18px;animation-delay:.2s;}
.call-wave span:nth-child(4){height:13px;animation-delay:.3s;}
.call-wave span:nth-child(5){height:6px;animation-delay:.4s;}

#call-connecting-state .call-av-wrap{
    width:68px;height:68px;
}
#call-connecting-state .call-avatar{
    width:68px;height:68px;
}

#call-window-controls{
    position:relative;z-index:10;flex-shrink:0;
    display:flex;align-items:center;justify-content:center;
    padding:8px 12px 16px;
}
.call-hangup-btn{
    width:56px;height:56px;
    border-radius:50%;border:none;cursor:pointer;
    display:flex;align-items:center;justify-content:center;
    background:linear-gradient(135deg,#ff5252,#c62828);
    box-shadow:0 6px 20px rgba(255,82,82,.5),0 0 0 1px rgba(255,255,255,.1);
    transition:transform .18s,box-shadow .2s;
    padding:14px;
}
.call-hangup-btn:hover{transform:scale(1.1);box-shadow:0 10px 28px rgba(255,82,82,.6);}
.call-hangup-btn:active{transform:scale(.9);}

.call-util-btn{
    position:absolute;z-index:10;
    width:28px;height:28px;border-radius:50%;border:none;
    background:rgba(255,255,255,.13);backdrop-filter:blur(8px);
    color:rgba(255,255,255,.65);cursor:pointer;font-size:10px;
    display:flex;align-items:center;justify-content:center;
    transition:background .2s,color .2s,transform .15s;
}
.call-util-btn:hover{background:rgba(255,255,255,.24);color:#fff;transform:scale(1.1);}
.call-util-btn.active{background:rgba(255,255,255,.28);color:#fff;}
#call-bg-btn{bottom:70px;right:10px;}
#call-immersive-btn{bottom:70px;left:10px;}
#call-bg-file-input{display:none;}

#call-window.immersive #call-window-header,
#call-window.immersive #call-window-body,
#call-window.immersive #call-connecting-state,
#call-window.immersive #call-window-controls,
#call-window.immersive #call-bg-btn,
#call-window.immersive .call-overlay{opacity:0 !important;pointer-events:none !important;}
#call-window.immersive #call-immersive-btn{opacity:.35 !important;pointer-events:all !important;}
#call-window.immersive #call-immersive-btn:hover{opacity:1 !important;}

#call-resize-handle{
    position:absolute;bottom:-2px;right:-2px;z-index:99901;
    width:22px;height:22px;cursor:se-resize;
    display:flex;align-items:flex-end;justify-content:flex-end;
    padding:5px;touch-action:none;
}
#call-resize-handle::after{
    content:'';width:10px;height:10px;
    border-right:2px solid rgba(255,255,255,.35);
    border-bottom:2px solid rgba(255,255,255,.35);
    border-radius:0 0 4px 0;
}

#call-size-presets{
    position:fixed;z-index:99960;
    display:none;flex-direction:column;gap:2px;
    background:rgba(12,18,36,.94);backdrop-filter:blur(18px);
    border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:5px;
    box-shadow:0 12px 38px rgba(0,0,0,.55);min-width:140px;
}
#call-size-presets.open{display:flex;animation:cFi .18s ease;}
.call-size-btn{
    padding:7px 11px;font-size:12px;color:rgba(255,255,255,.8);
    background:none;border:none;border-radius:8px;
    cursor:pointer;white-space:nowrap;text-align:left;
    transition:background .15s;display:flex;align-items:center;gap:8px;
}
.call-size-btn:hover{background:rgba(255,255,255,.1);color:#fff;}
.call-size-btn i{color:var(--accent-color,#e0698a);width:12px;}

#call-mini-pill{
    position:fixed;bottom:82px;right:16px;z-index:99901;
    display:none;align-items:center;gap:9px;
    background:rgba(10,18,38,.92);backdrop-filter:blur(20px);
    border:1px solid rgba(255,255,255,.12);
    border-radius:30px;padding:8px 14px 8px 10px;
    box-shadow:0 8px 28px rgba(0,0,0,.4);
    cursor:grab;color:#fff;user-select:none;touch-action:none;
}
#call-mini-pill:active{cursor:grabbing;}
#call-mini-pill.visible{display:flex;animation:cPi .3s cubic-bezier(.22,1,.36,1);}
.call-mini-av{
    width:30px;height:30px;border-radius:50%;
    background:var(--accent-color,#e0698a);overflow:hidden;
    display:flex;align-items:center;justify-content:center;flex-shrink:0;
}
.call-mini-av img{width:100%;height:100%;object-fit:cover;}
.call-mini-av i{font-size:12px;color:rgba(255,255,255,.82);}
.call-mini-info{display:flex;flex-direction:column;gap:1px;}
.call-mini-name{font-size:12px;font-weight:600;line-height:1.1;}
.call-mini-time{font-size:11px;color:rgba(255,255,255,.5);font-variant-numeric:tabular-nums;font-weight:500;}
.call-mini-dot{width:6px;height:6px;border-radius:50%;background:#4caf50;box-shadow:0 0 5px #4caf50;animation:cBl 1.6s ease-in-out infinite alternate;flex-shrink:0;}
.call-mini-hangup{
    width:30px;height:30px;border-radius:50%;border:none;
    background:rgba(255,82,82,.75);cursor:pointer;
    display:flex;align-items:center;justify-content:center;padding:8px;
    transition:background .2s,transform .15s;flex-shrink:0;
}
.call-mini-hangup:hover{background:#ff5252;transform:scale(1.12);}

#call-toolbar-btn{
    background-color:var(--toolbar-btn-bg, var(--message-received-bg)) !important;
    color:var(--toolbar-btn-color, var(--text-secondary)) !important;
}
#call-toolbar-btn:hover{color:var(--text-primary) !important;}
body.bottom-collapse-mode #call-toolbar-btn{display:none !important;}

html[data-theme="dark"][data-color-theme="black-white"]{
    --accent-color: #c0c0c0;
    --accent-color-rgb: 192,192,192;
    --accent-color-dark: #e0e0e0;
    --message-sent-bg: #3a3a3a;
    --message-sent-text: #ffffff;
}
html:not([data-theme="dark"])[data-color-theme="black-white"] .message-sent{
    color: #ffffff !important;
}

@keyframes cFi{from{opacity:0}to{opacity:1}}
@keyframes cCu{from{opacity:0;transform:translateY(28px) scale(.94)}to{opacity:1;transform:none}}
@keyframes cWi{from{opacity:0;transform:scale(.84) translateY(18px)}to{opacity:1;transform:none}}
@keyframes cPi{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:none}}
@keyframes cRp{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:.12;transform:scale(1.12)}}
@keyframes cAp{0%,100%{opacity:.6;transform:scale(1)}50%{opacity:.12;transform:scale(1.14)}}
@keyframes cBl{from{opacity:1}to{opacity:.18}}
@keyframes cOrb{0%{transform:translate(0,0) rotate(0)}33%{transform:translate(18px,-14px) rotate(120deg)}66%{transform:translate(-10px,18px) rotate(240deg)}100%{transform:translate(0,0) rotate(360deg)}}
@keyframes cWv{0%,100%{transform:scaleY(1);opacity:.5}50%{transform:scaleY(.32);opacity:.22}}
@keyframes cCd{0%,80%,100%{transform:scale(.72);opacity:.3}40%{transform:scale(1.22);opacity:1}}

#call-resume-overlay{
    position:fixed;inset:0;z-index:99995;
    display:none;align-items:center;justify-content:center;
    background:rgba(0,0,0,.65);
    backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);
}
#call-resume-overlay.visible{display:flex;animation:cFi .35s ease;}
.call-resume-card{
    width:300px;
    background:linear-gradient(160deg,rgba(255,255,255,.11),rgba(255,255,255,.04));
    border:1px solid rgba(255,255,255,.18);border-radius:32px;
    padding:40px 28px 32px;
    display:flex;flex-direction:column;align-items:center;gap:8px;color:#fff;
    box-shadow:0 32px 80px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.15);
    animation:cCu .45s cubic-bezier(.22,1,.36,1);
    position:relative;overflow:hidden;
}
.call-resume-card::before{
    content:'';position:absolute;inset:0;pointer-events:none;
    background:radial-gradient(ellipse at 50% 0%,rgba(var(--accent-color-rgb,224,105,138),.28),transparent 65%);
}
.call-resume-icon-wrap{
    width:72px;height:72px;border-radius:50%;
    background:rgba(var(--accent-color-rgb,224,105,138),.18);
    display:flex;align-items:center;justify-content:center;
    margin-bottom:6px;position:relative;
}
.call-resume-icon-wrap i{font-size:30px;color:var(--accent-color,#e0698a);}
.call-resume-icon-wrap::after{
    content:'';position:absolute;inset:-8px;border-radius:50%;
    border:1.5px solid rgba(255,255,255,.15);
    animation:cRp 2.2s ease-in-out infinite;
}
.call-resume-avatar{
    width:64px;height:64px;border-radius:50%;
    background:var(--accent-color,#e0698a);overflow:hidden;
    display:flex;align-items:center;justify-content:center;
    border:2px solid rgba(255,255,255,.25);
    box-shadow:0 6px 22px rgba(0,0,0,.4);
}
.call-resume-avatar img{width:100%;height:100%;object-fit:cover;}
.call-resume-avatar i{font-size:24px;color:rgba(255,255,255,.82);}
.call-resume-name{font-size:20px;font-weight:700;margin-top:6px;}
.call-resume-duration{
    font-size:28px;font-weight:800;letter-spacing:.04em;
    color:rgba(255,255,255,.95);font-variant-numeric:tabular-nums;
    margin-top:2px;
}
.call-resume-sub{font-size:12.5px;color:rgba(255,255,255,.48);margin-top:2px;}
.call-resume-actions{display:flex;gap:16px;margin-top:24px;width:100%;}
.call-resume-btn{
    flex:1;padding:13px 0;border:none;border-radius:14px;
    font-size:14px;font-weight:600;cursor:pointer;
    display:flex;align-items:center;justify-content:center;gap:7px;
    transition:transform .15s,box-shadow .2s;font-family:inherit;
}
.call-resume-btn:active{transform:scale(.95);}
.call-resume-continue{
    background:linear-gradient(135deg,#4caf50,#2e7d32);
    color:#fff;box-shadow:0 6px 20px rgba(76,175,80,.4);
}
.call-resume-continue:hover{box-shadow:0 8px 26px rgba(76,175,80,.55);}
.call-resume-end{
    background:rgba(255,255,255,.1);color:rgba(255,255,255,.7);
    border:1px solid rgba(255,255,255,.15);
}
.call-resume-end:hover{background:rgba(255,82,82,.3);color:#fff;border-color:rgba(255,82,82,.4);}
        `;
        document.head.appendChild(el);
    }

    function injectHTML() {
        if (document.getElementById('call-feature-root')) return;
        const root = document.createElement('div');
        root.id = 'call-feature-root';
        root.innerHTML = `
<div id="call-incoming-overlay">
  <div class="call-inc-card">
    <div class="call-inc-ring">
      <div class="call-inc-avatar" id="call-inc-avatar"><i class="fas fa-user" id="call-inc-av-icon"></i></div>
    </div>
    <div class="call-inc-name" id="call-inc-name">对方</div>
    <div class="call-inc-sub"><span class="call-inc-sub-dot"></span><span>邀请您进行视频通话</span></div>
    <div class="call-inc-actions">
      <button class="call-inc-btn call-inc-reject" id="call-inc-reject">
        <div class="call-inc-circle">${SVG_HU}</div>
        <span class="call-inc-lbl">拒绝</span>
      </button>
      <button class="call-inc-btn call-inc-accept" id="call-inc-accept">
        <div class="call-inc-circle">
          <svg viewBox="0 0 24 24" fill="none" style="display:block;width:100%;height:100%;">
            <path d="M6.6 10.8c1.4 2.8 3.7 5.1 6.5 6.5l2.2-2.2c.28-.27.68-.36 1.03-.24 1.1.37 2.3.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.56 21 3 13.44 3 4c0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.28.2 2.5.57 3.57.11.35.03.74-.24 1.02L6.6 10.8z" fill="white"/>
          </svg>
        </div>
        <span class="call-inc-lbl">接听</span>
      </button>
    </div>
  </div>
</div>

<div id="call-window">
  <div id="call-window-inner">
    <div id="call-window-bg">
      <div class="call-bg-grad"></div>
      <div class="call-orb call-orb-1"></div>
      <div class="call-orb call-orb-2"></div>
      <div class="call-orb call-orb-3"></div>
      <img id="call-bg-img" src="" alt="">
    </div>
    <div class="call-overlay"></div>

    <div id="call-window-header">
      <div class="call-badge">
        <span class="call-rec-dot"></span>
        <span class="call-timer-txt" id="call-timer-display">00:00</span>
      </div>
      <div class="call-top-btns">
        <button class="call-top-btn" id="call-size-preset-toggle" title="调整大小"><i class="fas fa-expand-alt"></i></button>
        <button class="call-top-btn" id="call-minimize-btn" title="最小化"><i class="fas fa-minus"></i></button>
      </div>
    </div>

    <div id="call-connecting-state">
      <div class="call-av-wrap">
        <div class="call-av-pulse"></div>
        <div class="call-av-pulse2"></div>
        <div class="call-avatar" id="call-conn-avatar"><i class="fas fa-user" id="call-conn-av-icon"></i></div>
      </div>
      <div class="call-name" id="call-conn-name">对方</div>
      <div style="font-size:11px;color:rgba(255,255,255,.4);display:flex;align-items:center;gap:5px;">
        <i class="fas fa-video" style="font-size:9px;"></i> 正在连接
      </div>
      <div class="call-conn-dots"><span></span><span></span><span></span></div>
    </div>

    <div id="call-window-body">
      <div class="call-av-wrap">
        <div class="call-av-pulse"></div>
        <div class="call-av-pulse2"></div>
        <div class="call-avatar" id="call-win-avatar"><i class="fas fa-user" id="call-win-av-icon"></i></div>
      </div>
      <div class="call-name" id="call-win-name">通话中</div>
      <div class="call-wave"><span></span><span></span><span></span><span></span><span></span></div>
    </div>

    <button class="call-util-btn" id="call-immersive-btn" title="沉浸模式"><i class="fas fa-eye-slash"></i></button>
    <button class="call-util-btn" id="call-bg-btn" title="更换背景"><i class="fas fa-image"></i></button>
    <input type="file" id="call-bg-file-input" accept="image/*,.gif">

    <div id="call-window-controls">
      <button class="call-hangup-btn" id="call-hangup-btn">${SVG_HU}</button>
    </div>
  </div>
  <div id="call-resize-handle"></div>
</div>

<div id="call-size-presets">
  <button class="call-size-btn" data-w="160" data-h="240"><i class="fas fa-compress-alt"></i>迷你</button>
  <button class="call-size-btn" data-w="220" data-h="350"><i class="fas fa-minus-square"></i>小</button>
  <button class="call-size-btn" data-w="280" data-h="440"><i class="fas fa-square"></i>标准</button>
  <button class="call-size-btn" data-w="360" data-h="560"><i class="fas fa-expand"></i>大</button>
</div>

<div id="call-mini-pill">
  <div class="call-mini-av" id="call-mini-av"><i class="fas fa-user" id="call-mini-av-icon"></i></div>
  <div class="call-mini-info">
    <div class="call-mini-name" id="call-mini-name">通话中</div>
    <div class="call-mini-time" id="call-mini-timer">00:00</div>
  </div>
  <span class="call-mini-dot"></span>
  <button class="call-mini-hangup" id="call-mini-hangup">${SVG_HU}</button>
</div>

<div id="call-resume-overlay">
  <div class="call-resume-card">
    <div class="call-resume-icon-wrap">
      <i class="fas fa-phone-alt"></i>
    </div>
    <div class="call-resume-avatar" id="call-resume-avatar"><i class="fas fa-user"></i></div>
    <div class="call-resume-name" id="call-resume-name">对方</div>
    <div class="call-resume-duration" id="call-resume-duration">00:00</div>
    <div class="call-resume-sub" id="call-resume-sub">上次通话因页面退出而中断</div>
    <div class="call-resume-actions">
      <button class="call-resume-btn call-resume-end" id="call-resume-end">
        <i class="fas fa-phone-slash" style="font-size:13px;"></i>结束通话
      </button>
      <button class="call-resume-btn call-resume-continue" id="call-resume-continue">
        <i class="fas fa-phone" style="font-size:13px;"></i>继续通话
      </button>
    </div>
  </div>
</div>
        `;
        document.body.appendChild(root);
    }

    function injectToolbarBtn() {
        if (document.getElementById('call-toolbar-btn')) return;
        const anchor = document.getElementById('attachment-btn');
        if (!anchor) return;
        const btn = document.createElement('button');
        btn.id = 'call-toolbar-btn';
        btn.title = '视频通话';
        btn.className = 'input-btn collapse-hideable';
        btn.style.display = S.enabled ? '' : 'none';
        btn.innerHTML = '<i class="fas fa-video"></i>';
        btn.addEventListener('click', () => {
            if (!S.enabled) return;
            if (S.active) { restoreWindow(); return; }
            startCall(false);
        });
        anchor.parentNode.insertBefore(btn, anchor);
    }

    function fmt(ms) {
        const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
        return h > 0
            ? `${h}:${String(m % 60).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`
            : `${String(m).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
    }
    const getAvSrc = () => {
        const img = document.querySelector('#partner-avatar img,[id*="partner-avatar"] img,.partner-avatar img');
        return img ? img.src : null;
    };
    const getName = () => window.settings?.partnerName || document.getElementById('partner-name')?.textContent.trim() || '对方';

    function fillAv(avId) {
        const av = document.getElementById(avId), src = getAvSrc();
        if (av) av.innerHTML = src
            ? `<img src="${src}" alt="" style="width:100%;height:100%;object-fit:cover;">`
            : `<i class="fas fa-user"></i>`;
    }
    function fillNm(id) { const e = document.getElementById(id); if (e) e.textContent = getName(); }

    function tick() {
        if (!S.active || !S.startTime) return;
        S.elapsed = Date.now() - S.startTime;
        const t = fmt(S.elapsed);
        const a = document.getElementById('call-timer-display');
        const b = document.getElementById('call-mini-timer');
        if (a) a.textContent = t;
        if (b) b.textContent = t;
        // 每 2 秒自动保存通话状态，防止页面闪退时丢失
        if (S.elapsed - S.lastSessionSave > 2000) {
            S.lastSessionSave = S.elapsed;
            saveSession();
        }
        S.timerRAF = requestAnimationFrame(tick);
    }

    function applyBg() {
        const img = document.getElementById('call-bg-img');
        if (!img) return;
        if (S.bgImage) { img.src = S.bgImage; img.style.display = 'block'; }
        else { img.src = ''; img.style.display = 'none'; }
    }

    /* ── 通话中断恢复：保存 / 清除 / 检测 / 恢复 ── */

    // 保存当前通话状态到 localStorage（用于刷新/闪退后恢复）
    function saveSession() {
        if (!S.active || !S.startTime) return;
        const session = {
            active:       true,
            elapsed:      Date.now() - S.startTime,
            isPartnerCall:S.isPartnerCall,
            timestamp:    Date.now(),
            partnerName:  getName(),
            minimized:    S.minimized,
            immersive:    S.immersive,
        };
        try { localStorage.setItem(KEY_SESSION, JSON.stringify(session)); } catch(_) {}
    }

    function clearSession() {
        try { localStorage.removeItem(KEY_SESSION); } catch(_) {}
        S.lastSessionSave = 0;
    }

    // 页面加载后检测是否有中断的通话，弹窗询问是否恢复
    function checkAndResumeCall() {
        let session = null;
        try { session = JSON.parse(localStorage.getItem(KEY_SESSION)); } catch(_) { return; }
        if (!session || !session.active || !session.elapsed) { clearSession(); return; }

        // 超过有效期 → 自动结束并清除
        if (Date.now() - session.timestamp > SESSION_MAX_AGE) {
            if (session.elapsed > 2000) sendCallEvent('fa-video', '视频通话已结束', fmt(session.elapsed));
            clearSession();
            return;
        }
        // 通话时间太短 → 不值得恢复
        if (session.elapsed < SESSION_MIN_DUR) { clearSession(); return; }

        showResumeDialog(session);
    }

    function showResumeDialog(session) {
        const ov = document.getElementById('call-resume-overlay');
        if (!ov) return;

        const nameEl = document.getElementById('call-resume-name');
        const durEl  = document.getElementById('call-resume-duration');
        const avEl   = document.getElementById('call-resume-avatar');
        const subEl  = document.getElementById('call-resume-sub');

        if (nameEl) nameEl.textContent = session.partnerName || getName();
        if (durEl)  durEl.textContent  = fmt(session.elapsed);
        if (subEl)  subEl.textContent  = '上次通话因页面退出而中断';

        const src = getAvSrc();
        if (avEl) avEl.innerHTML = src
            ? `<img src="${src}" alt="" style="width:100%;height:100%;object-fit:cover;">`
            : `<i class="fas fa-user"></i>`;

        S._pendingResume = session;
        ov.classList.add('visible');
    }

    // 恢复中断的通话（保留已通话时长）
    function resumeCall(session) {
        S.active       = true;
        S.startTime    = Date.now() - session.elapsed;
        S.elapsed      = session.elapsed;
        S.minimized    = false;
        S.isPartnerCall= session.isPartnerCall || false;
        S.immersive    = false;
        document.getElementById('call-window')?.classList.remove('immersive');

        ['call-inc-avatar','call-conn-avatar','call-win-avatar','call-mini-av'].forEach(fillAv);
        ['call-conn-name','call-win-name','call-mini-name'].forEach(fillNm);
        applyBg(); positionWindow();

        const win  = document.getElementById('call-window');
        const body = document.getElementById('call-window-body');
        const conn = document.getElementById('call-connecting-state');
        const timerEl = document.getElementById('call-timer-display');
        if (win)    win.classList.add('visible');
        if (conn)   conn.classList.remove('visible');
        if (body)   body.style.display = '';
        if (timerEl) timerEl.textContent = fmt(session.elapsed);

        S.lastSessionSave = session.elapsed;
        tick();
        clearSession();

        if (typeof showNotification === 'function')
            showNotification('通话已恢复 · 继续与' + getName() + '的视频通话', 'success', 3000);
    }

    // 放弃恢复，正常结束通话并记录
    function endInterruptedCall(session) {
        if (session.elapsed > 2000)
            sendCallEvent('fa-video', '视频通话已结束', fmt(session.elapsed));
        if (typeof showNotification === 'function')
            showNotification('通话已结束 · ' + fmt(session.elapsed), 'info', 3000);
        clearSession();
    }

    function positionWindow() {
        const win = document.getElementById('call-window');
        if (!win) return;
        win.style.width = S.size.w + 'px';
        win.style.height = S.size.h + 'px';
        if (S.pos) {
            win.style.left   = clamp(S.pos.x, 0, window.innerWidth  - S.size.w) + 'px';
            win.style.top    = clamp(S.pos.y, 0, window.innerHeight - S.size.h) + 'px';
            win.style.right  = 'auto'; win.style.bottom = 'auto';
        } else {
            win.style.right  = '20px'; win.style.top = '72px';
            win.style.left   = 'auto'; win.style.bottom = 'auto';
        }
    }
    function positionPill() {
        const pill = document.getElementById('call-mini-pill');
        if (!pill || !S.pillPos) return;
        pill.style.left   = clamp(S.pillPos.x, 0, window.innerWidth  - (pill.offsetWidth  || 180)) + 'px';
        pill.style.top    = clamp(S.pillPos.y, 0, window.innerHeight - (pill.offsetHeight || 50))  + 'px';
        pill.style.right  = 'auto'; pill.style.bottom = 'auto';
    }

    function sendCallEvent(icon, label, detail) {
        if (typeof window._addCallEvent === 'function') {
            window._addCallEvent(icon, label, detail);
        } else if (typeof window.messages !== 'undefined') {
            // 降级：直接写入 messages 数组（适用于 beforeunload 等异步不可用场景）
            window.messages.push({
                id: Date.now() + Math.random(),
                sender: 'system',
                text: label + (detail ? ' · ' + detail : ''),
                timestamp: new Date(),
                status: 'received',
                type: 'call-event',
                callIcon: icon || 'fa-video',
                callDetail: detail || null,
                favorited: false,
                note: null,
            });
        } else {
            let tries = 0;
            const t = setInterval(() => {
                if (typeof window._addCallEvent === 'function') {
                    clearInterval(t);
                    window._addCallEvent(icon, label, detail);
                }
                if (++tries > 25) clearInterval(t);
            }, 200);
        }
    }

    function sendCallMsg(dur) {
        if (dur < 2000) return;
        sendCallEvent('fa-video', '视频通话已结束', fmt(dur));
    }

    function startCall(isPartner) {
        if (!S.enabled) return;
        clearSession();
        S.active = true; S.startTime = null; S.elapsed = 0;
        S.minimized = false; S.isPartnerCall = !!isPartner; S.immersive = false;
        document.getElementById('call-window')?.classList.remove('immersive');

        ['call-inc-avatar','call-conn-avatar','call-win-avatar','call-mini-av'].forEach(fillAv);
        ['call-conn-name','call-win-name','call-mini-name'].forEach(fillNm);
        applyBg(); positionWindow();

        const win  = document.getElementById('call-window');
        const body = document.getElementById('call-window-body');
        const conn = document.getElementById('call-connecting-state');
        const timerEl = document.getElementById('call-timer-display');
        if (win)    win.classList.add('visible');
        if (conn)   conn.classList.add('visible');
        if (body)   body.style.display = 'none';
        if (timerEl) timerEl.textContent = '连接中';

        clearTimeout(S.connectingTimer);

        if (!isPartner && Math.random() < 0.35) {
            const rejectDelay = 4000 + Math.random() * 8000;
            S.connectingTimer = setTimeout(() => {
                if (!S.active) return;
                S.active = false;
                cancelAnimationFrame(S.timerRAF);
                const winEl = document.getElementById('call-window');
                if (winEl) { winEl.classList.remove('visible'); winEl.classList.remove('immersive'); }
                const connEl = document.getElementById('call-connecting-state');
                if (connEl) connEl.classList.remove('visible');
                const bodyEl = document.getElementById('call-window-body');
                if (bodyEl) bodyEl.style.display = '';
                const rejectLabels = [
                    getName() + ' 未接听',
                    getName() + ' 正在忙，无法接听',
                    getName() + ' 拒绝了通话',
                    getName() + ' 暂时无法接听',
                ];
                const lbl = rejectLabels[Math.floor(Math.random() * rejectLabels.length)];
                sendCallEvent('fa-phone-slash', lbl, null);
                if (typeof showNotification === 'function')
                    showNotification(lbl, 'info', 3000);
            }, rejectDelay);
        } else {
            S.connectingTimer = setTimeout(() => {
                if (!S.active) return;
                S.startTime = Date.now();
                if (conn) conn.classList.remove('visible');
                if (body) body.style.display = '';
                tick();
            }, 1400 + Math.random() * 1400);
        }
    }

    function endCall() {
        if (!S.active) return;
        const dur = S.elapsed;
        S.active = false; S.startTime = null;
        cancelAnimationFrame(S.timerRAF);
        clearTimeout(S.connectingTimer); clearTimeout(S.incomingTimer);
        clearSession();

        ['call-window','call-mini-pill','call-incoming-overlay'].forEach(id => {
            const e = document.getElementById(id);
            if (e) { e.classList.remove('visible'); if (id === 'call-window') e.classList.remove('immersive'); }
        });
        const body = document.getElementById('call-window-body');
        const conn = document.getElementById('call-connecting-state');
        if (body) body.style.display = '';
        if (conn) conn.classList.remove('visible');
        S.immersive = false;
        const iBtn = document.getElementById('call-immersive-btn');
        if (iBtn) { iBtn.classList.remove('active'); iBtn.querySelector('i').className = 'fas fa-eye-slash'; }

        localStorage.setItem(KEY_POS,  JSON.stringify(S.pos));
        localStorage.setItem(KEY_SIZE, JSON.stringify(S.size));
        sendCallMsg(dur);
        if (typeof showNotification === 'function' && dur > 1500)
            showNotification(`通话结束 · ${fmt(dur)}`, 'info', 3000);
        else if (typeof showNotification === 'function' && dur <= 1500 && dur > 0)
            showNotification('通话已挂断', 'info', 2000);
    }

    // 请求系统通知权限
    function ensureNotificationPermission() {
        if (!('Notification' in window)) return Promise.resolve('unsupported');
        if (Notification.permission === 'granted') return Promise.resolve('granted');
        if (Notification.permission === 'denied') return Promise.resolve('denied');
        return Notification.requestPermission();
    }

    // 发送系统级通知（用户在其他App/标签页时也能看到）
    function showSystemCallNotification(partnerName) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        try {
            const notif = new Notification(`${partnerName} 来电`, {
                body: '邀请您进行视频通话…',
                tag: 'call-incoming',
                requireInteraction: true,
                icon: (typeof settings !== 'undefined' && settings.partnerAvatar) || undefined,
                silent: false
            });
            notif.onclick = function() {
                window.focus();
                this.close();
            };
            // 30 秒后自动关闭（避免长期残留）
            setTimeout(() => { try { notif.close(); } catch(e){} }, 30000);
        } catch(e) { /* 通知失败不影响网页内弹窗 */ }
    }

    function showIncomingCall() {
        if (!S.enabled || S.active) return;
        const ov = document.getElementById('call-incoming-overlay');
        if (!ov) return;
        fillAv('call-inc-avatar'); fillNm('call-inc-name');
        ov.classList.add('visible');
        clearTimeout(S.incomingTimer);

        // 来电消息弹窗（复用项目通用样式）
        const partnerName = getName();

        // 同时发送系统级通知（用户在其他App/标签页时能看到）
        showSystemCallNotification(partnerName);

        try {
            const existing = document.getElementById('call-incoming-toast');
            if (existing) existing.remove();
            const toast = document.createElement('div');
            toast.id = 'call-incoming-toast';
            toast.innerHTML = `
                <div style="position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:10000;background:var(--secondary-bg);border:1px solid var(--border-color);border-radius:16px;padding:16px 20px;box-shadow:0 8px 32px rgba(0,0,0,0.2);max-width:360px;font-family:var(--font-family);">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                        <div style="width:36px;height:36px;border-radius:50%;background:rgba(var(--accent-color-rgb),0.15);display:flex;align-items:center;justify-content:center;">
                            <i class="fas fa-phone" style="color:var(--accent-color);font-size:16px;animation:cBl 1.1s step-end infinite;"></i>
                        </div>
                        <div style="flex:1;">
                            <div style="font-size:14px;font-weight:600;color:var(--text-primary);">${partnerName} 来电</div>
                            <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">邀请您进行视频通话…</div>
                        </div>
                        <button onclick="document.getElementById('call-incoming-toast')&amp;&amp;document.getElementById('call-incoming-toast').remove()" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:4px;font-size:16px;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div style="display:flex;gap:10px;">
                        <button onclick="document.getElementById('call-inc-reject')&amp;&amp;document.getElementById('call-inc-reject').click();document.getElementById('call-incoming-toast')&amp;&amp;document.getElementById('call-incoming-toast').remove()" style="flex:1;padding:9px 14px;border:1px solid var(--border-color);border-radius:10px;background:transparent;color:var(--text-secondary);font-size:13px;cursor:pointer;font-family:var(--font-family);">
                            忽略
                        </button>
                        <button onclick="document.getElementById('call-inc-accept')&amp;&amp;document.getElementById('call-inc-accept').click();document.getElementById('call-incoming-toast')&amp;&amp;document.getElementById('call-incoming-toast').remove()" style="flex:1;padding:9px 14px;border:none;border-radius:10px;background:var(--accent-color);color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font-family);">
                            接听
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(toast);
            // 来电浮层关闭时同步移除弹窗
            const removeToast = () => {
                const el = document.getElementById('call-incoming-toast');
                if (el) el.remove();
            };
            // 8 秒后自动消失（比来电超时短，避免长期停留）
            setTimeout(removeToast, 8000);
        } catch(e) { /* 弹窗失败不影响来电功能 */ }

        const autoRejectChance = 0.30;
        if (Math.random() < autoRejectChance) {
            const rejectDelay = 4000 + Math.random() * 6000;
            S.incomingTimer = setTimeout(() => {
                if (!ov.classList.contains('visible')) return;
                ov.classList.remove('visible');
                document.getElementById('call-incoming-toast')?.remove();
                const myName = (typeof settings !== 'undefined' && settings.myName) || '我';
                const partnerName = getName();
                const rejectLabels = [
                    `${partnerName} 的来电，${myName}未接听`,
                    `${myName}拒绝了 ${partnerName} 的通话`,
                    `错过了 ${partnerName} 的来电`,
                    `${myName}暂时无法接听 ${partnerName} 的通话`,
                ];
                const label = rejectLabels[Math.floor(Math.random() * rejectLabels.length)];
                sendCallEvent('fa-phone-slash', label, null);
            }, rejectDelay);
        } else {
            S.incomingTimer = setTimeout(() => {
                if (!ov.classList.contains('visible')) return;
                ov.classList.remove('visible');
                document.getElementById('call-incoming-toast')?.remove();
                const myName = (typeof settings !== 'undefined' && settings.myName) || '我';
                sendCallEvent('fa-phone-slash', `${myName}未接听 ${getName()} 的来电`, null);
            }, 22000);
        }
    }

    function scheduleRandomCall() {
        clearTimeout(S.randomCallTimer);
        if (!S.enabled) return;
        const ms = (15 + Math.random() * 45) * 60 * 1000;
        S.randomCallTimer = setTimeout(() => {
            if (S.enabled && !S.active && Math.random() < 0.25) showIncomingCall();
            scheduleRandomCall();
        }, ms);
    }

    function minimizeWindow() {
        S.minimized = true;
        document.getElementById('call-window')?.classList.remove('visible');
        const pill = document.getElementById('call-mini-pill');
        if (pill) { pill.classList.add('visible'); positionPill(); }
    }
    function restoreWindow() {
        S.minimized = false;
        const win = document.getElementById('call-window');
        if (win) { positionWindow(); win.classList.add('visible'); }
        document.getElementById('call-mini-pill')?.classList.remove('visible');
    }

    function toggleImmersive() {
        S.immersive = !S.immersive;
        document.getElementById('call-window')?.classList.toggle('immersive', S.immersive);
        const btn = document.getElementById('call-immersive-btn');
        if (btn) {
            btn.classList.toggle('active', S.immersive);
            btn.querySelector('i').className = S.immersive ? 'fas fa-eye' : 'fas fa-eye-slash';
        }
    }

    function openSizePresets() {
        const p = document.getElementById('call-size-presets');
        const b = document.getElementById('call-size-preset-toggle');
        if (!p || !b) return;
        const r = b.getBoundingClientRect();
        p.style.top  = (r.bottom + 8) + 'px';
        p.style.left = Math.max(8, r.left - 40) + 'px';
        p.classList.add('open');
    }

    function initDrag() {
        const hdr = document.getElementById('call-window-header');
        const win = document.getElementById('call-window');
        if (!hdr || !win) return;
        let on = false;
        hdr.addEventListener('pointerdown', e => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            e.preventDefault();
            const r = win.getBoundingClientRect();
            S.dragOff = { x: e.clientX - r.left, y: e.clientY - r.top };
            on = true;
            try { hdr.setPointerCapture(e.pointerId); } catch(_) {}
        });
        hdr.addEventListener('pointermove', e => {
            if (!on || !S.dragOff) return; e.preventDefault();
            win.style.left   = clamp(e.clientX - S.dragOff.x, 0, window.innerWidth  - win.offsetWidth)  + 'px';
            win.style.top    = clamp(e.clientY - S.dragOff.y, 0, window.innerHeight - win.offsetHeight) + 'px';
            win.style.right  = 'auto'; win.style.bottom = 'auto';
        });
        const stop = e => {
            if (!on) return; on = false; S.dragOff = null;
            const r = win.getBoundingClientRect(); S.pos = { x: r.left, y: r.top };
            localStorage.setItem(KEY_POS, JSON.stringify(S.pos));
            try { hdr.releasePointerCapture(e.pointerId); } catch(_) {}
        };
        hdr.addEventListener('pointerup', stop);
        hdr.addEventListener('pointercancel', stop);
    }

    function initPillDrag() {
        const pill = document.getElementById('call-mini-pill');
        if (!pill) return;
        let on = false;
        pill.addEventListener('pointerdown', e => {
            if (e.target.closest('.call-mini-hangup')) return;
            e.preventDefault();
            const r = pill.getBoundingClientRect();
            S.pillDragOff = { x: e.clientX - r.left, y: e.clientY - r.top };
            S.pillDragged = false; on = true;
            try { pill.setPointerCapture(e.pointerId); } catch(_) {}
        });
        pill.addEventListener('pointermove', e => {
            if (!on || !S.pillDragOff) return; e.preventDefault();
            S.pillDragged = true;
            pill.style.left   = clamp(e.clientX - S.pillDragOff.x, 0, window.innerWidth  - pill.offsetWidth)  + 'px';
            pill.style.top    = clamp(e.clientY - S.pillDragOff.y, 0, window.innerHeight - pill.offsetHeight) + 'px';
            pill.style.right  = 'auto'; pill.style.bottom = 'auto';
        });
        const stop = e => {
            if (!on) return; on = false;
            if (S.pillDragged) {
                const r = pill.getBoundingClientRect();
                S.pillPos = { x: r.left, y: r.top };
                localStorage.setItem(KEY_PILL_POS, JSON.stringify(S.pillPos));
            }
            S.pillDragOff = null;
            try { pill.releasePointerCapture(e.pointerId); } catch(_) {}
        };
        pill.addEventListener('pointerup', stop);
        pill.addEventListener('pointercancel', stop);
    }

    function initResize() {
        const h = document.getElementById('call-resize-handle');
        const win = document.getElementById('call-window');
        if (!h || !win) return;
        let on = false;
        h.addEventListener('pointerdown', e => {
            e.preventDefault(); e.stopPropagation();
            const r = win.getBoundingClientRect();
            S.resizeInit = { ex: e.clientX, ey: e.clientY, w: r.width, h: r.height };
            on = true;
            try { h.setPointerCapture(e.pointerId); } catch(_) {}
        });
        h.addEventListener('pointermove', e => {
            if (!on || !S.resizeInit) return; e.preventDefault();
            S.size.w = clamp(S.resizeInit.w + (e.clientX - S.resizeInit.ex), 160, 600);
            S.size.h = clamp(S.resizeInit.h + (e.clientY - S.resizeInit.ey), 240, 800);
            win.style.width = S.size.w + 'px'; win.style.height = S.size.h + 'px';
        });
        const stop = e => {
            if (!on) return; on = false; S.resizeInit = null;
            localStorage.setItem(KEY_SIZE, JSON.stringify(S.size));
            try { h.releasePointerCapture(e.pointerId); } catch(_) {}
        };
        h.addEventListener('pointerup', stop);
        h.addEventListener('pointercancel', stop);
    }

    function bindEvents() {
        document.getElementById('call-inc-reject')?.addEventListener('click', () => {
            document.getElementById('call-incoming-overlay')?.classList.remove('visible');
            document.getElementById('call-incoming-toast')?.remove();
            clearTimeout(S.incomingTimer);
            const myName = (typeof settings !== 'undefined' && settings.myName) || '我';
            sendCallEvent('fa-phone-slash', `${myName}拒绝了 ${getName()} 的通话`, null);
        });
        document.getElementById('call-inc-accept')?.addEventListener('click', () => {
            document.getElementById('call-incoming-overlay')?.classList.remove('visible');
            document.getElementById('call-incoming-toast')?.remove();
            clearTimeout(S.incomingTimer); startCall(true);
        });

        document.getElementById('call-hangup-btn')?.addEventListener('click', endCall);
        document.getElementById('call-mini-hangup')?.addEventListener('click', e => { e.stopPropagation(); endCall(); });

        // 通话恢复对话框按钮
        document.getElementById('call-resume-continue')?.addEventListener('click', () => {
            document.getElementById('call-resume-overlay')?.classList.remove('visible');
            if (S._pendingResume) { resumeCall(S._pendingResume); S._pendingResume = null; }
        });
        document.getElementById('call-resume-end')?.addEventListener('click', () => {
            document.getElementById('call-resume-overlay')?.classList.remove('visible');
            if (S._pendingResume) { endInterruptedCall(S._pendingResume); S._pendingResume = null; }
        });
        document.getElementById('call-minimize-btn')?.addEventListener('click', minimizeWindow);
        document.getElementById('call-mini-pill')?.addEventListener('click', e => {
            if (e.target.closest('.call-mini-hangup')) return;
            if (!S.pillDragged) restoreWindow();
        });
        document.getElementById('call-immersive-btn')?.addEventListener('click', e => { e.stopPropagation(); toggleImmersive(); });
        document.getElementById('call-window')?.addEventListener('click', e => {
            if (S.immersive && !e.target.closest('#call-immersive-btn')) toggleImmersive();
        });

        document.getElementById('call-size-preset-toggle')?.addEventListener('click', e => {
            e.stopPropagation();
            const p = document.getElementById('call-size-presets');
            if (!p) return;
            p.classList.contains('open') ? p.classList.remove('open') : openSizePresets();
        });
        document.addEventListener('click', e => {
            const btn = e.target.closest('.call-size-btn'); if (!btn) return;
            S.size.w = +btn.dataset.w; S.size.h = +btn.dataset.h;
            const win = document.getElementById('call-window');
            if (win) { win.style.width = S.size.w + 'px'; win.style.height = S.size.h + 'px'; }
            document.getElementById('call-size-presets')?.classList.remove('open');
            localStorage.setItem(KEY_SIZE, JSON.stringify(S.size));
        });
        document.addEventListener('click', e => {
            if (!e.target.closest('#call-size-preset-toggle') && !e.target.closest('#call-size-presets'))
                document.getElementById('call-size-presets')?.classList.remove('open');
        });

        document.getElementById('call-bg-btn')?.addEventListener('click', () => document.getElementById('call-bg-file-input')?.click());
        document.getElementById('call-bg-file-input')?.addEventListener('change', e => {
            const f = e.target.files?.[0]; if (!f) return;
            const r = new FileReader();
            r.onload = ev => { S.bgImage = ev.target.result; saveBg(S.bgImage); applyBg(); showNotification?.('通话背景已更新 ✓','success',2000); };
            r.readAsDataURL(f); e.target.value = '';
        });

        document.addEventListener('change', e => {
            if (e.target.id !== 'call-enabled-toggle') return;
            S.enabled = e.target.checked;
            localStorage.setItem(KEY_ENABLED, S.enabled);
            const btn = document.getElementById('call-toolbar-btn');
            if (btn) btn.style.display = S.enabled ? '' : 'none';
            const collapsedCallBtn = document.getElementById('collapsed-call-btn');
            if (collapsedCallBtn) collapsedCallBtn.style.display = S.enabled ? '' : 'none';
            if (!S.enabled && S.active) endCall();
            S.enabled ? scheduleRandomCall() : clearTimeout(S.randomCallTimer);
        });

        initDrag(); initPillDrag(); initResize();
    }

    window.callFeature = { startCall, endCall, showIncomingCall, restoreWindow, minimizeWindow };

    // 页面真正关闭/刷新时（beforeunload 才是可靠信号），如果正在通话则保存状态以便恢复，
    // 并彻底清理内存中的通话状态
    function handlePageUnload() {
        if (S.active) {
            saveSession();
            S.active = false; S.startTime = null;
            cancelAnimationFrame(S.timerRAF);
            clearTimeout(S.connectingTimer); clearTimeout(S.incomingTimer);
            // 确保同步保存，不依赖 throttledSaveData 的 500ms 延迟
            if (typeof window._backupCriticalData === 'function') {
                window._backupCriticalData();
            }
        }
    }
    // 移动端切后台（锁屏/切应用/最小化）时 pagehide 也会触发，但页面并没有真正关闭。
    // 如果这里也走 handlePageUnload 的完整清理逻辑，会把内存里 S.active 强制置为
    // false、并取消计时器，但通话窗口的 UI 并不会被隐藏——等用户切回前台时，
    // 通话窗口还停留在屏幕上、看起来仍在通话，但内部状态其实已经"挂断"了，
    // 于是对方可以在这时重新发起一通新的来电（因为 S.active 已被误置为 false）。
    // 所以 pagehide 只做和 visibilitychange 一样的"保存快照"，不清空活跃状态，
    // 真正关闭页面时会有 beforeunload 兜底做完整清理。
    function handlePageHide() {
        if (S.active && S.startTime) {
            saveSession();
            if (typeof window._backupCriticalData === 'function') {
                window._backupCriticalData();
            }
        }
    }
    window.addEventListener('beforeunload', handlePageUnload);
    // pagehide 在移动端比 beforeunload 更可靠触发，但只用来做快照备份，不清空通话状态
    window.addEventListener('pagehide', handlePageHide);

    // visibilitychange：移动端切后台/切前台的关键事件
    // 移动端 beforeunload/pagehide 经常不触发，但 visibilitychange 一定能触发
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            // 页面切到后台（切应用、按Home键、锁屏等）→ 立即保存通话状态
            if (S.active && S.startTime) {
                saveSession();
            }
        } else {
            // 页面回到前台 → 如果通话已因后台暂停而"断掉"，刷新计时器
            if (S.active && S.startTime) {
                // RAF 在后台会被暂停，回来后重新启动
                cancelAnimationFrame(S.timerRAF);
                tick();
            }
        }
    });

    // freeze 事件：部分移动端浏览器在资源不足时冻结页面
    window.addEventListener('freeze', function() {
        if (S.active && S.startTime) saveSession();
    });

    function init() {
        injectCSS();
        injectHTML();
        bindEvents();
        loadBg();

        const late = () => {
            injectToolbarBtn();
            if (S.enabled) scheduleRandomCall();
            // 检测是否有中断的通话，弹窗询问是否恢复
            checkAndResumeCall();
            // 首次进入聊天时请求通知权限（用于来电跨App提醒）
            if (S.enabled && 'Notification' in window && Notification.permission === 'default') {
                // 延迟请求，避免一进来就弹权限框
                setTimeout(() => {
                    try { Notification.requestPermission(); } catch(e) {}
                }, 3000);
            }
            const syncCallToggle = () => {
                const tog = document.getElementById('call-enabled-toggle');
                if (tog) {
                    tog.checked = S.enabled;
                }
                const collapsedCallBtn = document.getElementById('collapsed-call-btn');
                if (collapsedCallBtn) collapsedCallBtn.style.display = S.enabled ? '' : 'none';
            };
            syncCallToggle();
            const chatModal = document.getElementById('chat-modal');
            if (chatModal) {
                new MutationObserver(() => {
                    if (chatModal.style.display === 'flex' || chatModal.style.display === 'block') {
                        setTimeout(syncCallToggle, 50);
                    }
                }).observe(chatModal, { attributes: true, attributeFilter: ['style'] });
            }
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(late, 800));
        else setTimeout(late, 800);
    }

    init();
})();
