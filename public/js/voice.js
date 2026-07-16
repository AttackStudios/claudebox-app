// ClaudeBox Voice — shared WebRTC voice chat used by every game (and hub DM
// calls). Audio is peer-to-peer; the server only relays signaling through
// /voice-ws rooms. Opt-in: nothing touches the mic until the player taps Join.
//
//   import { initVoice } from '/js/voice.js';
//   const vc = initVoice({ room: 'pizza' });            // floating 🎙️ chip UI
//   const vc = initVoice({ room: 'dm:a|b', chip: false }); // headless (DM UI)
//
// Returned api: { join, leave, toggleMute, joined, muted, peers, onUpdate, destroy }

const RTC = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function myName() {
  try {
    const v = localStorage.getItem('claudebox.user');
    if (v && v.trim()) return v.trim();
    const p = JSON.parse(localStorage.getItem('featherfriends.lastProfile') || '{}');
    if (p.name) return p.name;
  } catch {}
  return null;
}

export function initVoice(opts = {}) {
  const room = String(opts.room || '');
  if (!room) return null;

  const st = {
    ws: null, id: null, stream: null, joined: false, muted: false,
    peers: new Map(),     // id -> { pc, name, audio }
    wantOn: false, closed: false, listeners: new Set(),
  };
  const emit = () => { for (const f of st.listeners) { try { f(api); } catch {} } syncChip(); };

  // ---------------------- signaling ----------------------
  function connect() {
    if (st.closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/voice-ws`);
    st.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({
        t: 'join', room, name: myName() || 'Player',
        code: localStorage.getItem('claudebox.code') || '',
      }));
    };
    ws.onmessage = async (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'joined') {
        st.id = m.id; st.joined = true;
        for (const mem of m.members || []) peerFor(mem.id, mem.name, true); // we call the room
        emit();
      } else if (m.t === 'peer') {
        peerFor(m.id, m.name, false);   // newcomer calls us — just register
        emit();
      } else if (m.t === 'leave') {
        dropPeer(m.id); emit();
      } else if (m.t === 'sig') {
        await onSig(m.from, m.data);
      } else if (m.t === 'full') {
        toast('Voice room is full');
        leave();
      }
    };
    ws.onclose = () => {
      st.joined = false;
      for (const id of [...st.peers.keys()]) dropPeer(id);
      emit();
      if (st.wantOn && !st.closed) setTimeout(() => st.wantOn && connect(), 2500);
    };
    ws.onerror = () => {};
  }
  const sig = (to, data) => st.ws?.readyState === 1 && st.ws.send(JSON.stringify({ t: 'sig', to, data }));

  // ---------------------- peers ----------------------
  function peerFor(id, name, initiator) {
    if (st.peers.has(id)) return st.peers.get(id);
    const pc = new RTCPeerConnection(RTC);
    const peer = { pc, name: name || 'Player', audio: null, pendingIce: [] };
    st.peers.set(id, peer);
    if (st.stream) for (const tr of st.stream.getTracks()) pc.addTrack(tr, st.stream);
    pc.onicecandidate = (e) => e.candidate && sig(id, { ice: e.candidate });
    pc.ontrack = (e) => {
      if (peer.audio) peer.audio.remove();
      const a = document.createElement('audio');
      a.autoplay = true; a.playsInline = true; a.srcObject = e.streams[0];
      a.style.display = 'none';
      document.body.appendChild(a);
      a.play().catch(() => {});
      peer.audio = a;
    };
    if (initiator) {
      pc.onnegotiationneeded = async () => {
        try {
          await pc.setLocalDescription(await pc.createOffer());
          sig(id, { sdp: pc.localDescription });
        } catch {}
      };
    }
    return peer;
  }
  async function onSig(from, data) {
    if (!data) return;
    const peer = peerFor(from, st.peers.get(from)?.name, false);
    const pc = peer.pc;
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        for (const c of peer.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        if (data.sdp.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          sig(from, { sdp: pc.localDescription });
        }
      } else if (data.ice) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.ice).catch(() => {});
        else peer.pendingIce.push(data.ice);
      }
    } catch {}
  }
  function dropPeer(id) {
    const peer = st.peers.get(id);
    if (!peer) return;
    st.peers.delete(id);
    try { peer.pc.close(); } catch {}
    peer.audio?.remove();
  }

  // ---------------------- join / leave ----------------------
  async function join() {
    if (st.joined || st.wantOn) return;
    if (!myName()) { toast('Sign in on the home screen first'); return; }
    try {
      st.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch { toast('Mic permission needed for voice chat'); return; }
    st.wantOn = true; st.muted = false;
    connect();
    emit();
  }
  function leave() {
    st.wantOn = false; st.joined = false;
    for (const id of [...st.peers.keys()]) dropPeer(id);
    try { st.ws?.close(); } catch {}
    st.ws = null;
    st.stream?.getTracks().forEach((t) => t.stop());
    st.stream = null;
    emit();
  }
  function toggleMute() {
    if (!st.stream) return;
    st.muted = !st.muted;
    st.stream.getAudioTracks().forEach((t) => { t.enabled = !st.muted; });
    emit();
  }

  // ---------------------- floating chip UI ----------------------
  let chip = null, panel = null;
  function buildChip() {
    if (opts.chip === false || chip) return;
    const css = document.createElement('style');
    css.textContent = `
      #cbx-vc-btn{position:fixed;top:12px;left:120px;z-index:100000;width:46px;height:46px;border:none;border-radius:13px;
        background:rgba(20,24,34,.72);backdrop-filter:blur(10px);box-shadow:0 4px 14px rgba(0,0,0,.35);
        font-size:21px;display:grid;place-items:center;cursor:pointer;touch-action:none;color:#fff;}
      #cbx-vc-btn.on{box-shadow:0 0 0 2px rgba(90,220,140,.6),0 4px 14px rgba(0,0,0,.35);}
      #cbx-vc-btn.muted{box-shadow:0 0 0 2px rgba(255,160,90,.65),0 4px 14px rgba(0,0,0,.35);}
      #cbx-vc-btn .n{position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;border-radius:9px;background:#5adc8c;
        color:#0a1408;font:800 11px/18px -apple-system,sans-serif;padding:0 4px;display:none;}
      #cbx-vc-btn.on .n{display:block;}
      #cbx-vc-panel{position:fixed;top:64px;left:120px;z-index:100000;background:rgba(16,20,30,.92);backdrop-filter:blur(12px);
        border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:10px;min-width:170px;color:#e8eef8;
        font-family:-apple-system,'Trebuchet MS',sans-serif;display:none;}
      #cbx-vc-panel.open{display:block;}
      #cbx-vc-panel .who{font-size:12.5px;opacity:.85;margin:2px 0 8px;max-height:110px;overflow:auto;}
      #cbx-vc-panel .row{display:flex;gap:6px;}
      #cbx-vc-panel button{flex:1;border:none;border-radius:9px;padding:8px 0;font-weight:800;font-size:12.5px;cursor:pointer;}
      #cbx-vc-panel .mute{background:#2a3245;color:#fff;}
      #cbx-vc-panel .off{background:#e2574f;color:#fff;}`;
    document.head.appendChild(css);
    chip = document.createElement('button');
    chip.id = 'cbx-vc-btn';
    chip.title = 'Voice chat';
    chip.innerHTML = '🎙️<span class="n">0</span>';
    panel = document.createElement('div');
    panel.id = 'cbx-vc-panel';
    panel.innerHTML = `<div class="who"></div><div class="row">
      <button class="mute">Mute</button><button class="off">Leave</button></div>`;
    chip.addEventListener('click', () => {
      if (!st.wantOn) { join(); return; }
      panel.classList.toggle('open');
    });
    panel.querySelector('.mute').addEventListener('click', toggleMute);
    panel.querySelector('.off').addEventListener('click', () => { panel.classList.remove('open'); leave(); });
    document.body.appendChild(chip);
    document.body.appendChild(panel);
  }
  function syncChip() {
    if (!chip) return;
    chip.classList.toggle('on', st.wantOn && !st.muted);
    chip.classList.toggle('muted', st.wantOn && st.muted);
    chip.querySelector('.n').textContent = String(st.peers.size);
    chip.innerHTML = (st.wantOn && st.muted ? '🔇' : '🎙️') + `<span class="n">${st.peers.size}</span>`;
    const who = panel.querySelector('.who');
    who.textContent = st.peers.size
      ? 'With: ' + [...st.peers.values()].map((p) => p.name).join(', ')
      : (st.wantOn ? 'No one else in voice yet' : '');
    panel.querySelector('.mute').textContent = st.muted ? 'Unmute' : 'Mute';
    if (!st.wantOn) panel.classList.remove('open');
  }
  function toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:100002;background:#2f6fed;color:#fff;font-weight:800;font-family:-apple-system,sans-serif;font-size:13.5px;padding:10px 16px;border-radius:999px;box-shadow:0 6px 18px rgba(0,0,0,.4)';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  buildChip();
  addEventListener('pagehide', leave);

  const api = {
    join, leave, toggleMute,
    get joined() { return st.wantOn; },
    get muted() { return st.muted; },
    get peers() { return [...st.peers.values()].map((p) => p.name); },
    onUpdate(f) { st.listeners.add(f); return () => st.listeners.delete(f); },
    destroy() { st.closed = true; leave(); chip?.remove(); panel?.remove(); },
  };
  return api;
}

// Auto-init: every game page gets a voice room named after the game.
// Rivals keeps its own match-scoped voice chat, so it's skipped here.
const path = location.pathname;
if ((path.startsWith('/games/') || path === '/studio') && !path.includes('rivals')) {
  const room = path === '/studio' ? 'studio' : (path.split('/').filter(Boolean).pop() || 'game');
  const start = () => { if (!window.__cbxVoice) window.__cbxVoice = initVoice({ room }); };
  if (document.body) start(); else addEventListener('DOMContentLoaded', start);
}
