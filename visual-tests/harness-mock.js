// Мок FreePBX CLI: перехоплює click по #send, читає астериск-команду
// з #astcmd, генерує правдоподібну відповідь і пише її у pre[2] —
// саме так, як це робив би реальний FreePBX.
//
// Підтримуються всі команди, які надсилає розширення:
//   confbridge list                    — список конференцій
//   confbridge list <conf>             — список учасників конкретної конф
//   confbridge kick <conf> all         — викинути всіх
//   confbridge kick <conf> <sip>       — викинути одного
//   core show channels [verbose]       — список дзвінків
//   pjsip show aor|endpoint <sip>      — інформація про номер
//   pjsip show contacts                — список контактів (transport обрізаний!)
//   pjsip show contact <aor/uri>       — один контакт за повним ім'ям
//   channel request hangup <sip>       — покласти канал
(function () {
  const cmdLog = document.getElementById('cmdLog');
  const cmdInput = document.getElementById('astcmd');
  const sendBtn = document.getElementById('send');

  // Початкові списки учасників конференцій. Мок змінює їх при kick/kick-all.
  const initialUsers = {
    '5500': [
      { sip: 'SIP/200-00000abc', muted: 'No',  talking: 'No',  duration: '00:01:23' },
      { sip: 'SIP/201-00000def', muted: 'No',  talking: 'Yes', duration: '00:00:45' },
      { sip: 'SIP/202-00000fff', muted: 'No',  talking: 'No',  duration: '00:00:12' },
    ],
    '5501': [
      { sip: 'SIP/300-00000111', muted: 'No',  talking: 'No',  duration: '00:02:11' },
      { sip: 'SIP/301-00000222', muted: 'Yes', talking: 'No',  duration: '00:00:33' },
    ],
  };
  let users = cloneUsers();

  // Зареєстровані PJSIP-контакти: номер → ip:port. IP/порти різної довжини,
  // щоб обрізання transport в pjsip show contacts падало в різні місця.
  const contacts = {
    '200':  '192.168.0.50:50001',
    '201':  '192.168.100.123:50123',
    '202':  '192.168.0.7:5061',
    '2001': '192.168.10.77:50999',
  };

  function fullContact(peer) {
    return peer + '/sips:' + peer + '@' + contacts[peer] + ';transport=TLS';
  }

  // Asterisk друкує aor/uri у колонці фіксованої ширини — довше обрізається.
  const CONTACT_COL = 42;
  function truncateContact(peer) {
    return fullContact(peer).slice(0, CONTACT_COL).padEnd(CONTACT_COL);
  }

  function cloneUsers() {
    const c = {};
    for (const k in initialUsers) c[k] = initialUsers[k].map(u => ({ ...u }));
    return c;
  }

  function getScenario(name) {
    const el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }

  function getOutputPre() {
    // pre[2] — третій <pre> в документі, як і робить розширення.
    return document.querySelectorAll('pre')[2];
  }

  // Пише відповідь, ЗАМІНЮЮЧИ сам <pre> новим node-ом — саме так поводиться
  // реальний FreePBX (container.innerHTML = response), а не оновлює textContent.
  // Це навмисно: лише так harness відтворює баг, через який підсвітка раніше
  // "вмирала" після першого перерендеру (observer був прив'язаний до старого node).
  function setOutput(response) {
    const old = getOutputPre();
    const fresh = document.createElement('pre');
    if (old.id) fresh.id = old.id;
    fresh.textContent = response;
    old.parentNode.replaceChild(fresh, old);
  }

  function logCmd(rawCmd, response) {
    const line = document.createElement('div');
    line.className = 'log-line';

    const cmdSpan = document.createElement('span');
    cmdSpan.className = 'log-cmd';
    cmdSpan.textContent = '→ ' + rawCmd;
    line.appendChild(cmdSpan);

    if (response) {
      const resp = document.createElement('span');
      resp.className = 'log-resp';
      resp.textContent = response;
      line.appendChild(resp);
    }

    cmdLog.appendChild(line);
    cmdLog.scrollTop = cmdLog.scrollHeight;
  }

  function formatConfList(activeConfs) {
    const lines = [
      'Conference Bridge Name    Users  Marked Locked Muted',
      '======================== ======= ====== ====== =====',
    ];
    for (const c of activeConfs) {
      const count = users[c] ? users[c].length : 0;
      const pad = (s, n) => String(s).padEnd(n);
      lines.push(pad(c, 25) + pad(count, 8) + pad('0', 7) + pad('No', 7) + 'No');
    }
    return lines.join('\n');
  }

  function formatOneConf(conf) {
    const list = users[conf] || [];
    const header = [
      'Conference Bridge ' + conf + ' active',
      'Channel                    User Profile     Bridge Profile  Menu          Muted Talking Answer',
      '========================== ================ =============== ============= ===== ======= ======',
    ];
    if (list.length === 0) {
      header.push('(no users)');
      return header.join('\n');
    }
    for (const u of list) {
      header.push(
        'User: ' + u.sip.padEnd(22) +
        ' default_user     default_bridge  default_menu    ' +
        u.muted.padEnd(5) + ' ' + u.talking.padEnd(7) + ' ' + u.duration
      );
    }
    return header.join('\n');
  }

  function generateResponse(rawCmd) {
    // Розширення пише команди з подвійними пробілами між частинами
    // (sendQuery робить `${command}  ${number}  ${optional}`).
    // Тут нормалізуємо до одинарних пробілів — це безпечно й не залежить від точного формату.
    const cmd = rawCmd.replace(/\s+/g, ' ').trim();

    if (cmd === 'confbridge list') {
      const s = getScenario('conf-scenario');
      if (s === 'multi') return formatConfList(['5500', '5501']);
      if (s === 'single') return formatConfList(['5500']);
      return 'No active conferences.';
    }

    let m = cmd.match(/^confbridge list (\d+)$/);
    if (m) return formatOneConf(m[1]);

    m = cmd.match(/^confbridge kick (\d+) (.+)$/);
    if (m) {
      const conf = m[1];
      const target = m[2];
      if (target === 'all') {
        const n = (users[conf] || []).length;
        users[conf] = [];
        return 'Kicked ' + n + ' participants from conference ' + conf + '.';
      }
      const before = (users[conf] || []).length;
      if (users[conf]) {
        users[conf] = users[conf].filter(u => u.sip !== target);
      }
      const after = (users[conf] || []).length;
      if (after < before) return 'Kicked ' + target + ' from conference ' + conf + '.';
      return 'No such participant ' + target + ' in conference ' + conf + '.';
    }

    if (cmd === 'core show channels') {
      if (getScenario('calls-scenario') === 'none') {
        return '0 active channels\n0 active calls\n0 calls processed';
      }
      return [
        'Channel              Location             State   Application(Data)',
        'SIP/200-00000001     200@from-internal:1  Up      ConfBridge(5500)',
        'SIP/201-00000002     201@from-internal:1  Up      ConfBridge(5500)',
        '',
        '2 active channels',
        '1 active call',
        '4 calls processed',
      ].join('\n');
    }

    if (cmd === 'core show channels verbose') {
      if (getScenario('calls-scenario') === 'none') {
        return '0 active channels\n0 active calls\n0 calls processed';
      }
      return [
        'Channel             Context        Extension   Prio State  Application Data    CallerID Duration BridgeID',
        'SIP/200-00000001    from-internal  5500           1 Up     ConfBridge   5500  "Alice"  00:01:23  br1',
        'SIP/201-00000002    from-internal  5500           1 Up     ConfBridge   5500  "Bob"    00:00:45  br1',
        '',
        '2 active channels',
        '1 active call',
        '4 calls processed',
      ].join('\n');
    }

    m = cmd.match(/^pjsip show aor (.+)$/);
    if (m) {
      const c = contacts[m[1]];
      if (!c) return 'Unable to find object ' + m[1] + '.';
      return [
        '      Aor:  ' + m[1].padEnd(50) + '1',
        '    Contact:  ' + truncateContact(m[1]) + ' 5f3c2a1b8d Avail        12.345',
      ].join('\n');
    }

    m = cmd.match(/^pjsip show endpoint (.+)$/);
    if (m) {
      const c = contacts[m[1]];
      if (!c) return 'Unable to find object ' + m[1] + '.';
      return [
        ' Endpoint:  ' + m[1] + '/' + m[1] + '    Not in use    0 of inf',
        '     InAuth:  ' + m[1] + '-auth/' + m[1],
        '        Aor:  ' + m[1] + '    1',
        '      Contact:  ' + truncateContact(m[1]) + ' 5f3c2a1b8d Avail        12.345',
        '  Transport:  0.0.0.0-tls    tls    0    0  0.0.0.0:5061',
      ].join('\n');
    }

    if (cmd === 'pjsip show contacts') {
      const lines = [
        '  Contact:  <Aor/ContactUri..........................> <Hash....> <Status> <RTT(ms)..>',
        '==========================================================================================',
        '',
      ];
      for (const peer in contacts) {
        lines.push('  Contact:  ' + truncateContact(peer) + ' 5f3c2a1b8d Avail        12.345');
      }
      lines.push('', 'Objects found: ' + Object.keys(contacts).length);
      return lines.join('\n');
    }

    m = cmd.match(/^pjsip show contact (.+)$/);
    if (m) {
      const peer = Object.keys(contacts).find(p => fullContact(p) === m[1]);
      if (!peer) return 'Unable to find object ' + m[1] + '.';
      return [
        '  Contact:  ' + m[1] + ' 5f3c2a1b8d Avail        12.345',
        '',
        ' ParameterName        : ParameterValue',
        ' ===============================================',
        ' uri                  : sips:' + peer + '@' + contacts[peer],
        ' user_agent           : MicroSIP/3.21.3',
        ' via_addr             : ' + contacts[peer],
      ].join('\n');
    }

    m = cmd.match(/^channel request hangup (.+)$/);
    if (m) return 'Requested hangup on channel ' + m[1] + '.';

    return '[mock] Невідома команда: ' + cmd;
  }

  sendBtn.addEventListener('click', () => {
    const raw = cmdInput.value;
    if (!raw.trim()) return;
    const response = generateResponse(raw);
    setOutput(response);
    logCmd(raw, response);
  });

  document.getElementById('resetMock').addEventListener('click', () => {
    users = cloneUsers();
    setOutput('pre[2] — стан моку скинуто');
    const line = document.createElement('div');
    line.className = 'log-line';
    const span = document.createElement('span');
    span.style.color = '#fbbf24';
    span.textContent = '↺ стан моку скинуто (всі учасники повернуті)';
    line.appendChild(span);
    cmdLog.appendChild(line);
  });
})();
