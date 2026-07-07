// Flock panel: create a flock, see members, invite nearby players,
// teleport to the leader, kick/promote (leader only), leave/disband.

import { toast } from './chat.js';

export function buildFlockPanel(panel, game, panels) {
  const h = document.createElement('h2');
  h.textContent = '🪶 Flock';
  panel.appendChild(h);

  const me = game.me;
  const flock = me.flock ? game.flocks.get(me.flock) : null;

  if (!flock) {
    const info = document.createElement('p');
    info.textContent = 'A flock is your bird family — your flock name and rank appear over everyone\'s head.';
    info.style.fontSize = '13px';
    info.style.marginBottom = '10px';
    panel.appendChild(info);

    const nameRow = panels.row(panel, 'Flock name');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 24;
    nameInput.placeholder = 'The Cool Birds';
    nameRow.appendChild(nameInput);

    const colorRow = panels.row(panel, 'Flock color');
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = '#ffd24a';
    colorRow.appendChild(colorInput);

    const btnRow = panels.row(panel);
    panels.button(btnRow, '✨ Create flock', () => {
      const name = nameInput.value.trim();
      if (!name) return toast('Give your flock a name first!');
      game.net.send({ t: 'flock.create', name, color: colorInput.value });
      panels.closeAll();
    }, 'gold');
    return;
  }

  // ---- in a flock ----
  const isLeader = flock.leader === me.name.toLowerCase();
  const title = document.createElement('p');
  title.innerHTML = `You're ${isLeader ? 'the <b>Leader</b>' : 'a member'} of <b style="color:${flock.color}">${escapeHtml(flock.name)}</b>`;
  panel.appendChild(title);

  // members
  const list = document.createElement('div');
  list.style.margin = '10px 0';
  for (const memberName of flock.members) {
    const row = document.createElement('div');
    row.className = 'member-row';
    const online = [...game.players.values()].find((p) => p.data.name.toLowerCase() === memberName)
      || (memberName === me.name.toLowerCase() ? { data: { id: 'me', name: me.name } } : null);
    const nm = document.createElement('span');
    nm.className = 'mname';
    nm.textContent = (online?.data.name || memberName) + (online ? '' : ' 💤');
    row.appendChild(nm);
    // role badge
    const roleBadge = document.createElement('span');
    roleBadge.className = 'rank';
    roleBadge.textContent = memberName === flock.leader ? 'Leader' : (flock.roles?.[memberName] || 'Member');
    row.appendChild(roleBadge);
    if (memberName === flock.leader) {
      // (leader badge shown above)
    } else if (isLeader && online && online.data.id !== 'me') {
      const promote = document.createElement('button');
      promote.className = 'panel-btn';
      promote.style.padding = '4px 10px';
      promote.style.minHeight = '30px';
      promote.textContent = '👑';
      promote.title = 'Make leader';
      promote.addEventListener('click', () => game.net.send({ t: 'flock.promote', playerId: online.data.id }));
      const kick = document.createElement('button');
      kick.className = 'panel-btn warn';
      kick.style.padding = '4px 10px';
      kick.style.minHeight = '30px';
      kick.textContent = '✕';
      kick.title = 'Kick';
      kick.addEventListener('click', () => game.net.send({ t: 'flock.kick', playerId: online.data.id }));
      row.append(promote, kick);
    }
    list.appendChild(row);
  }
  panel.appendChild(list);

  // ---- your role within the flock ----
  if (!isLeader) {
    const roleHeader = document.createElement('div');
    roleHeader.className = 'field-label';
    roleHeader.textContent = 'Your role';
    panel.appendChild(roleHeader);
    const myRole = flock.roles?.[me.name.toLowerCase()] || 'Member';
    const roleRow = document.createElement('div');
    roleRow.className = 'role-picker';
    for (const role of ['Member', 'Worker', 'Caretaker', 'Adopter', 'Egg-baby', 'Hunter', 'Scout']) {
      const b = document.createElement('button');
      b.className = 'panel-btn' + (myRole === role ? ' gold' : '');
      b.style.minHeight = '30px';
      b.style.padding = '4px 10px';
      b.style.fontSize = '12px';
      b.textContent = role;
      b.addEventListener('click', () => game.net.send({ t: 'flock.role', playerId: me.id, role }));
      roleRow.appendChild(b);
    }
    panel.appendChild(roleRow);
  }

  // invite others
  if (isLeader) {
    const inviteHeader = document.createElement('div');
    inviteHeader.className = 'field-label';
    inviteHeader.textContent = 'Invite players';
    panel.appendChild(inviteHeader);
    let any = false;
    for (const p of game.players.values()) {
      if (p.data.flock === flock.name) continue;
      any = true;
      const row = document.createElement('div');
      row.className = 'member-row';
      const nm = document.createElement('span');
      nm.className = 'mname';
      nm.textContent = p.data.name;
      const invite = document.createElement('button');
      invite.className = 'panel-btn gold';
      invite.style.padding = '4px 12px';
      invite.style.minHeight = '30px';
      invite.textContent = 'Invite';
      invite.addEventListener('click', () => game.net.send({ t: 'flock.invite', playerId: p.data.id }));
      row.append(nm, invite);
      list.parentNode.insertBefore(row, null);
      panel.appendChild(row);
    }
    if (!any) {
      const none = document.createElement('p');
      none.style.fontSize = '13px';
      none.textContent = 'No other players online to invite right now.';
      panel.appendChild(none);
    }
  }

  const btns = panels.row(panel);
  if (!isLeader) {
    panels.button(btns, '🛬 Teleport to leader', () => {
      const leader = [...game.players.values()].find((p) => p.data.name.toLowerCase() === flock.leader);
      if (!leader) return toast('Your leader is offline.');
      game.teleportTo(leader.group.position.x + 1.5, leader.group.position.z + 1.5);
      panels.closeAll();
    }, 'gold');
  }
  panels.button(btns, '🚪 Leave flock', () => {
    game.net.send({ t: 'flock.leave' });
    panels.closeAll();
  }, 'warn');
  if (isLeader) {
    panels.button(btns, '💥 Disband', () => {
      game.net.send({ t: 'flock.disband' });
      panels.closeAll();
    }, 'warn');
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
