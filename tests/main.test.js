import { describe, test, expect } from 'vitest'
import { bootDOM } from './helpers.js'

// MutationObserver-и й await-и в main.js/utils.js — мікрозадачі. Один макротік їх зливає.
// (setTimeout тут Node-івський — window.setTimeout перехоплений bootDOM.)
const tick = () => new Promise((r) => setTimeout(r, 0))

// «Відповідь Asterisk»: FreePBX пише вивід у pre[2]. Заміну самого node покриває окремий тест.
const respond = (document, text) => {
  document.querySelectorAll('pre')[2].textContent = text
}

const astcmd = (document) => document.getElementById('astcmd').value

// Реальний формат `confbridge list` (app_confbridge: "%-32s %6u %6u %-6s %s").
const confList = (...rows) =>
  [
    'Conference Bridge Name           Users  Marked Locked Muted',
    '================================ ====== ====== ====== =====',
    ...rows,
  ].join('\n')
const confRow = (name, users, locked = 'No') =>
  `${name.padEnd(32)} ${String(users).padStart(6)} ${'0'.padStart(6)} ${locked.padEnd(6)} No`

describe('sendAndWait (utils.js)', () => {
  test('resolves with the response text as soon as pre[2] changes — no fixed delay', async () => {
    const { window, document } = bootDOM()
    const p = window.sendAndWait('core show uptime')
    expect(astcmd(document)).toBe('core show uptime      ')
    respond(document, 'System uptime: 1 hour')
    expect(await p).toBe('System uptime: 1 hour')
  })

  test('clears pre[2] BEFORE sending, so stale output is never mistaken for the answer', () => {
    const { window, document } = bootDOM()
    respond(document, 'stale output 5500 200')
    window.sendAndWait('confbridge list')
    expect(document.querySelectorAll('pre')[2].textContent).toBe('')
  })

  test('resolves when FreePBX swaps the whole <pre> node for a new one', async () => {
    const { window, document } = bootDOM()
    const p = window.sendAndWait('core show uptime')
    const old = document.querySelectorAll('pre')[2]
    const fresh = document.createElement('pre')
    fresh.textContent = 'System uptime: 2 hours'
    old.parentNode.replaceChild(fresh, old)
    expect(await p).toBe('System uptime: 2 hours')
  })

  test('resolves null after RESPONSE_TIMEOUT_MS when Asterisk never answers', async () => {
    const { window, pendingTimeouts, flushTimeouts } = bootDOM()
    const p = window.sendAndWait('core show uptime')
    expect(pendingTimeouts()[0].ms).toBe(5000)
    flushTimeouts()
    expect(await p).toBeNull()
  })

  test('resolves null when a DIFFERENT command is sent meanwhile (the answer is not ours)', async () => {
    const { window, document } = bootDOM()
    const p = window.sendAndWait('confbridge list')
    window.sendQuery('core show channels')
    respond(document, 'Channel   Location')
    expect(await p).toBeNull()
  })

  test('the SAME command re-sent (repeat tick) does not cancel the wait', async () => {
    const { window, document } = bootDOM()
    const p = window.sendAndWait('confbridge list')
    document.getElementById('send').click()
    respond(document, confList(confRow('5500', 1)))
    expect(await p).toContain('5500')
  })
})

describe('initExtension (auto-runs on script load)', () => {
  test('builds the #lazyAsterisk panel with every control button', () => {
    const { document } = bootDOM()
    expect(document.getElementById('lazyAsterisk')).not.toBeNull()
    expect(document.querySelector('.loadConfs')).not.toBeNull()
    expect(document.querySelector('.showCalls')).not.toBeNull()
    expect(document.querySelector('.showCallsDetailed')).not.toBeNull()
    expect(document.querySelector('.onRepeat')).not.toBeNull()
    expect(document.querySelector('.ext-output')).not.toBeNull()
  })

  test('prepends the panel into the SECOND .container-fluid', () => {
    const { document } = bootDOM()
    const containers = document.querySelectorAll('.container-fluid')
    expect(containers[1].querySelector('#lazyAsterisk')).not.toBeNull()
    expect(containers[0].querySelector('#lazyAsterisk')).toBeNull()
    // first child of container[1] should be our wrapper div
    expect(containers[1].firstElementChild.querySelector('#lazyAsterisk')).not.toBeNull()
  })
})

describe('kick helpers', () => {
  test('kickAll → "confbridge kick   <conf>   all" (leading space in " all" arg)', () => {
    const { window, document } = bootDOM()
    window.kickAll('5500')
    // sendQuery('confbridge kick ', '5500', ' all') → 3 spaces before "all"
    expect(document.getElementById('astcmd').value).toBe('confbridge kick   5500   all')
  })

  test('kickOne: kick → (response) → short settle → re-reads the conference', async () => {
    const { window, document, pendingTimeouts, flushTimeouts } = bootDOM()
    window.kickOne('5500', 'SIP/200-abc')
    expect(astcmd(document)).toBe('confbridge kick   5500  SIP/200-abc')

    respond(document, 'Kicked SIP/200-abc')
    await tick()
    const settle = pendingTimeouts()
    expect(settle).toHaveLength(1)
    expect(settle[0].ms).toBe(500)

    flushTimeouts()
    await tick()
    expect(astcmd(document)).toBe('confbridge list   5500   ')
  })

  test('kickOne re-reads the conference even if the kick response never came', async () => {
    const { window, document, flushTimeouts } = bootDOM()
    window.kickOne('5500', 'SIP/200-abc')
    flushTimeouts() // response timeout
    await tick()
    flushTimeouts() // settle
    await tick()
    expect(astcmd(document)).toBe('confbridge list   5500   ')
  })

  test('kickAll: after the response it refreshes the whole conference list (the conf is gone)', async () => {
    const { window, document, flushTimeouts } = bootDOM()
    window.kickAll('5500')
    respond(document, 'Kicked 3 participants')
    await tick()
    flushTimeouts()
    await tick()
    expect(astcmd(document)).toBe('confbridge list      ')
  })
})

describe('peer / call query helpers', () => {
  test('showAor → "pjsip show aor  <sip>"', () => {
    const { window, document } = bootDOM()
    window.showAor('200')
    expect(document.getElementById('astcmd').value).toBe('pjsip show aor  200   ')
  })

  test('showEndpoint → "pjsip show endpoint  <sip>"', () => {
    const { window, document } = bootDOM()
    window.showEndpoint('200')
    expect(document.getElementById('astcmd').value).toBe('pjsip show endpoint  200   ')
  })

  test('showCalls → "core show channels"', () => {
    const { window, document } = bootDOM()
    window.showCalls()
    expect(document.getElementById('astcmd').value).toBe('core show channels      ')
  })
})

describe('completeContactName (restores the transport cut off by pjsip show contacts)', () => {
  const full = '200/sips:200@192.168.0.50:50001;transport=TLS'
  const cuts = [
    '200/sips:200@192.168.0.50:50001;transport=TL',
    '200/sips:200@192.168.0.50:50001;transport=',
    '200/sips:200@192.168.0.50:50001;transpo',
    '200/sips:200@192.168.0.50:50001;t',
    '200/sips:200@192.168.0.50:50001;',
    '200/sips:200@192.168.0.50:50001',
  ]

  test.each(cuts)('%s → full name', (cut) => {
    const { window } = bootDOM()
    expect(window.completeContactName(cut)).toBe(full)
  })

  test('an already complete name is left untouched', () => {
    const { window } = bootDOM()
    expect(window.completeContactName(full)).toBe(full)
  })

  test('lower-case partial transport is completed case-insensitively', () => {
    const { window } = bootDOM()
    expect(window.completeContactName('200/sips:200@10.0.0.1:5061;trans')).toBe('200/sips:200@10.0.0.1:5061;transport=TLS')
  })
})

describe('peer row (pjsip show aor / endpoint / contact)', () => {
  const CONTACTS_OUTPUT = [
    '  Contact:  <Aor/ContactUri..........................> <Hash....> <Status> <RTT(ms)..>',
    '==========================================================================================',
    '',
    '  Contact:  2001/sips:2001@192.168.0.77:50999;transpo 1a2b3c4d5e Avail        10.000',
    '  Contact:  200/sips:200@192.168.100.123:50123;transp 5f3c2a1b8d Avail        12.345',
    '  Contact:  201/sips:201@192.168.0.51:5061;transport= a1b2c3d4e5 Avail         8.100',
    '',
    'Objects found: 3',
  ].join('\n')

  test('the row exists: input + AOR/Endpoint/Contact; old info/unregister/"1 номер" buttons are gone', () => {
    const { document } = bootDOM()
    expect(document.getElementById('peerInput')).not.toBeNull()
    expect(document.querySelector('.peerAor')).not.toBeNull()
    expect(document.querySelector('.peerEndpoint')).not.toBeNull()
    expect(document.querySelector('.peerContact')).not.toBeNull()
    expect(document.querySelector('.peerRow label[for="peerInput"]')).not.toBeNull()
    expect(document.querySelector('.peerInfo')).toBeNull()
    expect(document.querySelector('.loadExtensions')).toBeNull()
    expect(document.querySelector('.peerUnregister')).toBeNull()
  })

  test('AOR / Endpoint buttons send their command straight with the typed number', () => {
    const { document } = bootDOM()
    document.getElementById('peerInput').value = '200'
    document.querySelector('.peerAor').click()
    expect(document.getElementById('astcmd').value).toBe('pjsip show aor  200   ')
    document.querySelector('.peerEndpoint').click()
    expect(document.getElementById('astcmd').value).toBe('pjsip show endpoint  200   ')
  })

  test('a pasted channel name SIP/200-000000a3 is reduced to the peer name 200', () => {
    const { document } = bootDOM()
    document.getElementById('peerInput').value = 'SIP/200-000000a3'
    document.querySelector('.peerEndpoint').click()
    expect(document.getElementById('astcmd').value).toBe('pjsip show endpoint  200   ')
  })

  test('a pasted chan_pjsip channel PJSIP/200-0000001a is reduced to the peer name 200', () => {
    const { document } = bootDOM()
    document.getElementById('peerInput').value = 'PJSIP/200-0000001a'
    document.querySelector('.peerEndpoint').click()
    expect(astcmd(document)).toBe('pjsip show endpoint  200   ')
  })

  test('input is trimmed; a peer typed WITHOUT SIP/ prefix keeps its dashes intact', () => {
    const { document } = bootDOM()
    document.getElementById('peerInput').value = '  office-2  '
    document.querySelector('.peerAor').click()
    expect(document.getElementById('astcmd').value).toBe('pjsip show aor  office-2   ')
  })

  test('empty input: no button sends anything', () => {
    const { document, pendingTimeouts } = bootDOM()
    document.getElementById('peerInput').value = '   '
    document.querySelector('.peerAor').click()
    document.querySelector('.peerEndpoint').click()
    document.querySelector('.peerContact').click()
    expect(document.getElementById('astcmd').value).toBe('')
    expect(pendingTimeouts()).toHaveLength(0)
  })

  test('Enter inside the input triggers pjsip show endpoint', () => {
    const { window, document } = bootDOM()
    const input = document.getElementById('peerInput')
    input.value = '201'
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }))
    expect(document.getElementById('astcmd').value).toBe('pjsip show endpoint  201   ')
  })

  test('Contact: clears pre[2] and first sends "pjsip show contacts"', async () => {
    const { document } = bootDOM()
    const pres = document.querySelectorAll('pre')
    pres[2].textContent = 'stale  Contact:  200/sips:200@1.1.1.1:1;transport=TLS'
    document.getElementById('peerInput').value = '200'
    document.querySelector('.peerContact').click()
    expect(pres[2].textContent).toBe('')
    expect(document.getElementById('astcmd').value).toBe('pjsip show contacts      ')
  })

  test('Contact: picks the exact number (not 2001), completes the cut transport, sends pjsip show contact', async () => {
    const { document } = bootDOM()
    document.getElementById('peerInput').value = '200'
    document.querySelector('.peerContact').click()
    document.querySelectorAll('pre')[2].textContent = CONTACTS_OUTPUT
    await tick()
    expect(document.getElementById('astcmd').value)
      .toBe('pjsip show contact  200/sips:200@192.168.100.123:50123;transport=TLS   ')
    expect(document.querySelector('.peerStatus').textContent).toBe('')
  })

  test('Contact: works when the transport is cut right after "="', async () => {
    const { document } = bootDOM()
    document.getElementById('peerInput').value = '201'
    document.querySelector('.peerContact').click()
    document.querySelectorAll('pre')[2].textContent = CONTACTS_OUTPUT
    await tick()
    expect(document.getElementById('astcmd').value)
      .toBe('pjsip show contact  201/sips:201@192.168.0.51:5061;transport=TLS   ')
  })

  test('Contact: survives highlight <mark>s inside the output (reads textContent)', async () => {
    const { document } = bootDOM()
    document.getElementById('peerInput').value = '200'
    document.querySelector('.peerContact').click()
    document.querySelectorAll('pre')[2].innerHTML =
      '  Contact:  <mark class="lazy-highlight">200</mark>/sips:200@10.0.0.9:5061;tra 5f3c2a1b8d Avail 1.0'
    await tick()
    expect(document.getElementById('astcmd').value)
      .toBe('pjsip show contact  200/sips:200@10.0.0.9:5061;transport=TLS   ')
  })

  test('Contact: unknown number → no second command, status message shown', async () => {
    const { document } = bootDOM()
    document.getElementById('peerInput').value = '999'
    document.querySelector('.peerContact').click()
    document.querySelectorAll('pre')[2].textContent = CONTACTS_OUTPUT
    await tick()
    expect(document.getElementById('astcmd').value).toBe('pjsip show contacts      ')
    expect(document.querySelector('.peerStatus').textContent).toContain('999')
  })

  test('Contact: several contacts for one number → first one is shown, status says how many', async () => {
    const { document } = bootDOM()
    document.getElementById('peerInput').value = '200'
    document.querySelector('.peerContact').click()
    document.querySelectorAll('pre')[2].textContent = [
      '  Contact:  200/sips:200@10.0.0.1:5061;transport=TLS 1111111111 Avail 1.0',
      '  Contact:  200/sips:200@10.0.0.2:5061;transport=T   2222222222 Avail 1.0',
    ].join('\n')
    await tick()
    expect(document.getElementById('astcmd').value)
      .toBe('pjsip show contact  200/sips:200@10.0.0.1:5061;transport=TLS   ')
    expect(document.querySelector('.peerStatus').textContent).toContain('2')
  })

  test('the status message is cleared by the next peer action', async () => {
    const { document } = bootDOM()
    document.getElementById('peerInput').value = '999'
    document.querySelector('.peerContact').click()
    respond(document, CONTACTS_OUTPUT)
    await tick()
    expect(document.querySelector('.peerStatus').textContent).not.toBe('')
    document.querySelector('.peerAor').click()
    expect(document.querySelector('.peerStatus').textContent).toBe('')
  })
})

describe('onRepeat toggle', () => {
  test('first click starts a 5s interval and flips the label, second click stops it', () => {
    const { document, pendingIntervals } = bootDOM()
    const btn = document.querySelector('.onRepeat')
    // jsdom's innerText getter is undefined before assignment, but main.js writes to .innerText
    // after click. Read both: innerText after writes, textContent for the initial template.
    const label = () => (btn.innerText ?? btn.textContent).trim()

    expect(label()).toBe('Відправляти раз в 5 секунд')
    expect(btn.classList.contains('test')).toBe(false)

    btn.click()
    expect(label()).toBe('Перестати повторювати')
    expect(btn.classList.contains('test')).toBe(true)
    const intervals = pendingIntervals()
    expect(intervals).toHaveLength(1)
    expect(intervals[0].ms).toBe(5000)

    btn.click()
    expect(label()).toBe('Відправляти раз в 5 секунд')
    expect(btn.classList.contains('test')).toBe(false)
    expect(pendingIntervals()).toHaveLength(0)
  })
})

describe('repeat interval stepper (− / + buttons)', () => {
  const label = (btn) => (btn.innerText ?? btn.textContent).trim()

  test('the − / + buttons exist and sit BEFORE the onRepeat button', () => {
    const { document } = bootDOM()
    expect(document.querySelector('.repeatMinus')).not.toBeNull()
    expect(document.querySelector('.repeatPlus')).not.toBeNull()

    const buttons = Array.from(document.querySelectorAll('.controlButtons button'))
    const minusIdx = buttons.findIndex((b) => b.classList.contains('repeatMinus'))
    const plusIdx = buttons.findIndex((b) => b.classList.contains('repeatPlus'))
    const repeatIdx = buttons.findIndex((b) => b.classList.contains('onRepeat'))
    expect(minusIdx).toBeLessThan(repeatIdx)
    expect(plusIdx).toBeLessThan(repeatIdx)
  })

  test('+ bumps the interval; idle label reflects it', () => {
    const { document } = bootDOM()
    const btn = document.querySelector('.onRepeat')
    expect(label(btn)).toBe('Відправляти раз в 5 секунд')

    document.querySelector('.repeatPlus').click() // 6
    expect(label(btn)).toBe('Відправляти раз в 6 секунд')
  })

  test('− produces correct Ukrainian plurals and clamps at 1s minimum', () => {
    const { document } = bootDOM()
    const btn = document.querySelector('.onRepeat')
    const minus = document.querySelector('.repeatMinus')

    minus.click() // 4
    expect(label(btn)).toBe('Відправляти раз в 4 секунди')
    minus.click() // 3
    expect(label(btn)).toBe('Відправляти раз в 3 секунди')
    minus.click() // 2
    expect(label(btn)).toBe('Відправляти раз в 2 секунди')
    minus.click() // 1
    expect(label(btn)).toBe('Відправляти раз в 1 секунду')
    minus.click() // clamp — stays at 1
    expect(label(btn)).toBe('Відправляти раз в 1 секунду')
  })

  test('adjusting while IDLE does not start an interval', () => {
    const { document, pendingIntervals } = bootDOM()
    document.querySelector('.repeatPlus').click()
    expect(pendingIntervals()).toHaveLength(0)
  })

  test('adjusting while ACTIVE rebuilds the interval with new ms and restarts the bar', () => {
    const { document, pendingIntervals } = bootDOM()
    const btn = document.querySelector('.onRepeat')
    const fill = document.querySelector('.repeatProgress-fill')

    btn.click() // start at 5s
    expect(pendingIntervals()).toHaveLength(1)
    expect(pendingIntervals()[0].ms).toBe(5000)

    document.querySelector('.repeatPlus').click() // → 6s, rebuild
    const intervals = pendingIntervals()
    expect(intervals).toHaveLength(1) // old cleared, exactly one new
    expect(intervals[0].ms).toBe(6000)
    expect(fill.style.transition).toMatch(/width 6s linear/)

    // label stays "Перестати повторювати" while active
    expect(label(btn)).toBe('Перестати повторювати')
  })
})

describe('repeat progress bar', () => {
  test('the bar + fill are present in the panel but hidden by default', () => {
    const { document } = bootDOM()
    const bar = document.querySelector('.repeatProgress')
    const fill = document.querySelector('.repeatProgress-fill')
    expect(bar).not.toBeNull()
    expect(fill).not.toBeNull()
    expect(bar.classList.contains('active')).toBe(false)
  })

  test('starting repeat: bar becomes .active and fill is set to 100% with a 5s linear transition', () => {
    const { document } = bootDOM()
    const btn = document.querySelector('.onRepeat')
    const bar = document.querySelector('.repeatProgress')
    const fill = document.querySelector('.repeatProgress-fill')

    btn.click()

    expect(bar.classList.contains('active')).toBe(true)
    expect(fill.style.width).toBe('100%')
    expect(fill.style.transition).toMatch(/width 5s linear/)
  })

  test('stopping repeat: bar loses .active and fill is reset to 0% with no transition', () => {
    const { document } = bootDOM()
    const btn = document.querySelector('.onRepeat')
    const bar = document.querySelector('.repeatProgress')
    const fill = document.querySelector('.repeatProgress-fill')

    btn.click() // start
    btn.click() // stop

    expect(bar.classList.contains('active')).toBe(false)
    expect(fill.style.width).toBe('0%')
    expect(fill.style.transition).toBe('none')
  })

  test('interval callback re-kicks the bar (resets and re-fills) AND clicks #send', () => {
    const { document, pendingIntervals } = bootDOM()
    const btn = document.querySelector('.onRepeat')
    const fill = document.querySelector('.repeatProgress-fill')
    const send = document.getElementById('send')

    let sendClicks = 0
    send.addEventListener('click', () => sendClicks++)

    btn.click()

    const interval = pendingIntervals()[0]
    expect(interval).toBeDefined()
    expect(interval.ms).toBe(5000)

    // Simulate one interval tick
    interval.fn()

    // After tick: send was clicked AND fill is back to 100% with 5s transition
    // (the intermediate 0% is overwritten in the same synchronous block, so end state is 100%).
    expect(sendClicks).toBe(1)
    expect(fill.style.width).toBe('100%')
    expect(fill.style.transition).toMatch(/width 5s linear/)
  })
})

describe('loadAllConfs', () => {
  test('renders a select with every conference from the confbridge list table', async () => {
    const { window, document } = bootDOM()
    window.loadAllConfs()
    expect(astcmd(document)).toBe('confbridge list      ')
    respond(document, confList(confRow('5500', 3), confRow('5501', 1, 'Yes')))
    await tick()

    const select = document.querySelector('.ext-output select')
    expect(select).not.toBeNull()
    const options = select.querySelectorAll('option')
    // placeholder + 2 confs
    expect(options).toHaveLength(3)
    expect(options[0].text).toBe('Оберіть конференцію')
    expect(options[1].value).toBe('5500')
    expect(options[1].text).toBe('5500 — 3 учасники')
    expect(options[2].value).toBe('5501')
    expect(options[2].text).toBe('5501 — 1 учасник 🔒')
  })

  test('stale output with 3+ digit numbers is NOT turned into fake conferences', async () => {
    const { window, document } = bootDOM()
    // Попередня команда: учасники конференції / дзвінки — повно чисел.
    respond(document, 'PJSIP/200-00000abc  default_user  00:01:23\n2 active channels')
    window.loadAllConfs()
    respond(document, confList()) // конференцій немає: лише шапка
    await tick()

    expect(document.querySelector('.ext-output select')).toBeNull()
    expect(document.querySelector('.ext-output p').innerText).toMatch(/немає конференцій/)
  })

  test('shows a warning paragraph when no conferences are active (header only)', async () => {
    const { window, document } = bootDOM()
    window.loadAllConfs()
    respond(document, confList())
    await tick()

    const warning = document.querySelector('.ext-output p')
    expect(warning).not.toBeNull()
    expect(warning.innerText).toMatch(/немає конференцій/)
  })

  test('pressing the button repeatedly with no conferences keeps exactly ONE warning', async () => {
    const { window, document } = bootDOM()
    for (let i = 0; i < 3; i++) {
      window.loadAllConfs()
      respond(document, confList())
      await tick()
    }
    expect(document.querySelectorAll('.ext-output p')).toHaveLength(1)
  })

  test('empty → confs appear: the warning is replaced by the select (no leftovers)', async () => {
    const { window, document } = bootDOM()

    window.loadAllConfs()
    respond(document, confList())
    await tick()
    expect(document.querySelectorAll('.ext-output p')).toHaveLength(1)

    window.loadAllConfs()
    respond(document, confList(confRow('5500', 2)))
    await tick()
    expect(document.querySelectorAll('.ext-output p')).toHaveLength(0)
    expect(document.querySelectorAll('.ext-output select')).toHaveLength(1)
  })

  test('confs disappear: the select is replaced by a single warning', async () => {
    const { window, document } = bootDOM()

    window.loadAllConfs()
    respond(document, confList(confRow('5500', 2)))
    await tick()
    expect(document.querySelectorAll('.ext-output select')).toHaveLength(1)

    window.loadAllConfs()
    respond(document, confList())
    await tick()
    expect(document.querySelectorAll('.ext-output select')).toHaveLength(0)
    expect(document.querySelectorAll('.ext-output .refreshConf')).toHaveLength(0)
    expect(document.querySelectorAll('.ext-output p')).toHaveLength(1)
  })

  test('no response (timeout) leaves the current dropdown untouched', async () => {
    const { window, document, flushTimeouts } = bootDOM()
    window.loadAllConfs()
    respond(document, confList(confRow('5500', 2)))
    await tick()

    window.loadAllConfs()
    flushTimeouts()
    await tick()
    expect(document.querySelectorAll('.ext-output select')).toHaveLength(1)
  })

  test('changing the select triggers loadOneConf with the chosen conf', async () => {
    const { window, document } = bootDOM()
    window.loadAllConfs()
    respond(document, confList(confRow('5500', 2), confRow('5501', 2)))
    await tick()

    const select = document.querySelector('.ext-output select')
    select.value = '5501'
    select.dispatchEvent(new window.Event('change'))
    expect(astcmd(document)).toBe('confbridge list   5501   ')
  })

  test('going back to the placeholder sends nothing (no "confbridge list Оберіть конференцію")', async () => {
    const { window, document } = bootDOM()
    window.loadAllConfs()
    respond(document, confList(confRow('5500', 2)))
    await tick()

    const select = document.querySelector('.ext-output select')
    expect(select.options[0].value).toBe('')
    select.value = ''
    select.dispatchEvent(new window.Event('change'))
    expect(astcmd(document)).toBe('confbridge list      ')
  })

  test('↻ re-reads the SELECTED conference (re-picking the same option fires no change)', async () => {
    const { window, document } = bootDOM()
    window.loadAllConfs()
    respond(document, confList(confRow('5500', 2)))
    await tick()

    const select = document.querySelector('.ext-output select')
    select.value = '5500'
    select.dispatchEvent(new window.Event('change'))
    window.sendQuery('core show channels') // користувач пішов дивитись щось інше

    document.querySelector('.ext-output .refreshConf').click()
    expect(astcmd(document)).toBe('confbridge list   5500   ')
  })

  test('↻ with nothing selected re-reads the conference list', async () => {
    const { window, document } = bootDOM()
    window.loadAllConfs()
    respond(document, confList(confRow('5500', 2)))
    await tick()
    window.sendQuery('core show channels')

    document.querySelector('.ext-output .refreshConf').click()
    expect(astcmd(document)).toBe('confbridge list      ')
  })

  test('refreshing the list keeps the selected conference selected', async () => {
    const { window, document } = bootDOM()
    window.loadAllConfs()
    respond(document, confList(confRow('5500', 2), confRow('5501', 2)))
    await tick()
    window.loadOneConf('5501')

    window.loadAllConfs()
    respond(document, confList(confRow('5500', 2), confRow('5501', 3)))
    await tick()
    expect(document.querySelector('.ext-output select').value).toBe('5501')
  })
})

describe('loadOneConf', () => {
  test('inlines a kick button before every channel and appends a KICK ALL button', async () => {
    const { window, document } = bootDOM()
    const pres = document.querySelectorAll('pre')

    window.loadOneConf('5500')
    respond(document, [
      'Channel                        Flags  User Profile     Bridge Profile   Menu             CallerID',
      '============================== ====== ================ ================ ================ ========',
      'SIP/200-abc                           default_user     default_bridge   default_menu     200',
      'SIP/201-def                           default_user     default_bridge   default_menu     201',
      '',
    ].join('\n'))
    await tick()

    const kickBtns = pres[2].querySelectorAll('.generated-kick-btn')
    expect(kickBtns).toHaveLength(2)
    expect(kickBtns[0].dataset.sip).toBe('SIP/200-abc')
    expect(kickBtns[1].dataset.sip).toBe('SIP/201-def')

    const kickAll = pres[2].querySelector('.lazy-kick-all')
    expect(kickAll).not.toBeNull()
    expect(kickAll.textContent).toBe('ВИКИНУТИ ВСІХ (2)')
  })

  test('chan_pjsip channels get the FULL name PJSIP/… (not SIP/… cut out of the middle)', async () => {
    const { window, document } = bootDOM()
    const pres = document.querySelectorAll('pre')

    window.loadOneConf('5500')
    respond(document, 'PJSIP/200-0000001a    default_user\nLocal/300@from-internal-00000002;1    default_user\n')
    await tick()

    const kickBtns = pres[2].querySelectorAll('.generated-kick-btn')
    expect(kickBtns).toHaveLength(2)
    expect(kickBtns[0].dataset.sip).toBe('PJSIP/200-0000001a')
    expect(kickBtns[1].dataset.sip).toBe('Local/300@from-internal-00000002;1')
    // кнопка стоїть ПЕРЕД усім іменем, без «PJ» зліва від неї
    expect(pres[2].textContent).toContain('kickPJSIP/200-0000001a')
    expect(pres[2].textContent).not.toContain('PJkick')
  })

  test('conference that no longer exists: no KICK ALL, and the dropdown is refreshed', async () => {
    const { window, document } = bootDOM()
    const pres = document.querySelectorAll('pre')

    window.loadOneConf('5500')
    respond(document, "No conference bridge named '5500' found!")
    await tick()

    expect(pres[2].querySelectorAll('button')).toHaveLength(0)
    expect(astcmd(document)).toBe('confbridge list      ')
  })

  test('clicking an inline kick button kicks that channel from that conf', async () => {
    const { window, document } = bootDOM()
    const pres = document.querySelectorAll('pre')

    window.loadOneConf('5500')
    respond(document, 'SIP/200-abc   default_user\n')
    await tick()

    pres[2].querySelector('.generated-kick-btn').click()
    expect(astcmd(document)).toBe('confbridge kick   5500  SIP/200-abc')
  })

  test('KICK ALL needs a second click: the first one only arms the button', async () => {
    const { window, document } = bootDOM()
    const pres = document.querySelectorAll('pre')

    window.loadOneConf('5500')
    respond(document, 'SIP/200-abc   default_user\n')
    await tick()

    const kickAll = pres[2].querySelector('.lazy-kick-all')
    kickAll.click()
    expect(astcmd(document)).toBe('confbridge list   5500   ')
    expect(kickAll.classList.contains('armed')).toBe(true)
    expect(kickAll.textContent).toBe('Точно викинути всіх (1)? Натисни ще раз')

    kickAll.click()
    // Same string as the standalone kickAll test
    expect(astcmd(document)).toBe('confbridge kick   5500   all')
  })

  test('KICK ALL disarms itself after KICK_ALL_CONFIRM_MS — then one click is again not enough', async () => {
    const { window, document, pendingTimeouts, flushTimeouts } = bootDOM()
    window.loadOneConf('5500')
    respond(document, 'SIP/200-abc   default_user\n')
    await tick()

    const kickAll = document.querySelector('.lazy-kick-all')
    kickAll.click()
    expect(pendingTimeouts().map((t) => t.ms)).toContain(4000)
    flushTimeouts()
    expect(kickAll.classList.contains('armed')).toBe(false)
    expect(kickAll.textContent).toBe('ВИКИНУТИ ВСІХ (1)')

    kickAll.click()
    expect(astcmd(document)).toBe('confbridge list   5500   ')
  })

  test('LIVE: the armed state survives a repeat re-render (the button is a new node)', async () => {
    const { window, document } = bootDOM()
    window.loadOneConf('5500')
    respond(document, 'SIP/200-abc   default_user\nSIP/201-def   default_user\n')
    await tick()
    document.querySelector('.lazy-kick-all').click()

    const old = document.querySelectorAll('pre')[2]
    const fresh = document.createElement('pre')
    fresh.textContent = 'SIP/200-abc   default_user\nSIP/201-def   default_user\n'
    old.parentNode.replaceChild(fresh, old)
    await tick()

    const kickAll = fresh.querySelector('.lazy-kick-all')
    expect(kickAll.classList.contains('armed')).toBe(true)
    kickAll.click()
    expect(astcmd(document)).toBe('confbridge kick   5500   all')
  })

  test('arming one conference does not arm another', async () => {
    const { window, document } = bootDOM()
    window.loadOneConf('5500')
    respond(document, 'SIP/200-abc   default_user\n')
    await tick()
    document.querySelector('.lazy-kick-all').click()

    window.loadOneConf('5501')
    respond(document, 'SIP/300-abc   default_user\n')
    await tick()
    const kickAll = document.querySelector('.lazy-kick-all')
    expect(kickAll.classList.contains('armed')).toBe(false)
    kickAll.click()
    expect(astcmd(document)).toBe('confbridge list   5501   ')
  })

  test('a summary line with the participant count is added at the TOP of the output', async () => {
    const { window, document } = bootDOM()
    window.loadOneConf('5500')
    respond(document, 'SIP/200-abc   default_user\nSIP/201-def   default_user\nPJSIP/202-0001   default_user\n')
    await tick()

    const pre = document.querySelectorAll('pre')[2]
    const summary = pre.querySelector('.lazy-conf-summary')
    expect(pre.firstChild).toBe(summary)
    expect(summary.textContent).toBe('Зараз у конференції 5500: 3 учасники')
  })

  test.each([
    [1, '1 учасник'],
    [5, '5 учасників'],
  ])('summary plural for %i → "%s"', async (n, words) => {
    const { window, document } = bootDOM()
    window.loadOneConf('5500')
    respond(document, Array.from({ length: n }, (_, i) => `SIP/2${i}0-abc   default_user`).join('\n'))
    await tick()
    expect(document.querySelector('.lazy-conf-summary').textContent).toBe(`Зараз у конференції 5500: ${words}`)
  })

  test('LIVE: the summary follows the real count on every re-render and stays single', async () => {
    const { window, document } = bootDOM()
    window.loadOneConf('5500')
    respond(document, 'SIP/200-abc   default_user\nSIP/201-def   default_user\n')
    await tick()

    const old = document.querySelectorAll('pre')[2]
    const fresh = document.createElement('pre')
    fresh.textContent = 'SIP/201-def   default_user\n'
    old.parentNode.replaceChild(fresh, old)
    await tick()

    expect(fresh.querySelectorAll('.lazy-conf-summary')).toHaveLength(1)
    expect(fresh.querySelector('.lazy-conf-summary').textContent).toBe('Зараз у конференції 5500: 1 учасник')
  })

  test('the participant count in the dropdown option is updated from the live view', async () => {
    const { window, document } = bootDOM()
    window.loadAllConfs()
    respond(document, confList(confRow('5500', 2), confRow('5501', 1, 'Yes')))
    await tick()

    window.loadOneConf('5501')
    respond(document, 'SIP/300-abc   default_user\nSIP/301-abc   default_user\nSIP/302-abc   default_user\n')
    await tick()
    const option = document.querySelector('.ext-output option[value="5501"]')
    expect(option.text).toBe('5501 — 3 учасники 🔒')
  })

  test('LIVE: kick buttons come back after every repeat re-render (new <pre> node)', async () => {
    const { window, document, pendingIntervals } = bootDOM()

    window.loadOneConf('5500')
    respond(document, 'SIP/200-abc   default_user\nSIP/201-def   default_user\n')
    await tick()

    document.querySelector('.onRepeat').click()
    pendingIntervals()[0].fn() // повтор перенадсилає «confbridge list 5500»
    expect(astcmd(document)).toBe('confbridge list   5500   ')

    // FreePBX підміняє <pre> свіжим, уже без кнопок
    const old = document.querySelectorAll('pre')[2]
    const fresh = document.createElement('pre')
    fresh.textContent = 'SIP/201-def   default_user\n'
    old.parentNode.replaceChild(fresh, old)
    await tick()

    const kickBtns = fresh.querySelectorAll('.generated-kick-btn')
    expect(kickBtns).toHaveLength(1)
    expect(kickBtns[0].dataset.sip).toBe('SIP/201-def')
    expect(fresh.querySelectorAll('.lazy-kick-all')).toHaveLength(1)
  })

  test('buttons are added exactly once — no duplicates on later DOM mutations', async () => {
    const { window, document } = bootDOM()
    const pres = document.querySelectorAll('pre')

    window.loadOneConf('5500')
    respond(document, 'SIP/200-abc   default_user\n')
    await tick()
    // будь-яка інша мутація (напр., введення в поле підсвітки) не додає кнопок
    const input = document.getElementById('highlightInput')
    input.value = 'abc'
    input.dispatchEvent(new window.Event('input'))
    await tick()

    expect(pres[2].querySelectorAll('.generated-kick-btn')).toHaveLength(1)
    expect(pres[2].querySelectorAll('.lazy-kick-all')).toHaveLength(1)
  })

  test('a manually typed "confbridge list <conf>" also gets kick buttons', async () => {
    const { document } = bootDOM()
    document.getElementById('astcmd').value = 'confbridge list 5500'
    document.getElementById('send').click()
    respond(document, 'PJSIP/200-0000001a   default_user\n')
    await tick()
    expect(document.querySelectorAll('pre')[2].querySelectorAll('.generated-kick-btn')).toHaveLength(1)
  })
})

describe('repeat never re-sends destructive commands', () => {
  test.each([
    'confbridge kick   5500   all',
    'confbridge kick   5500  PJSIP/200-0000001a',
    'channel request hangup  PJSIP/200-0000001a   ',
    'channel originate  Local/210@from-internal  extension 5500@from-internal',
  ])('"%s" in the CLI is skipped by the repeat tick', (cmd) => {
    const { document, pendingIntervals } = bootDOM()
    let clicks = 0
    document.getElementById('send').addEventListener('click', () => clicks++)
    document.getElementById('astcmd').value = cmd
    document.querySelector('.onRepeat').click()
    pendingIntervals()[0].fn()
    expect(clicks).toBe(0)
  })
})

describe('repeat pauses while typing in the CLI and while the tab is hidden', () => {
  const startRepeat = (boot) => {
    let clicks = 0
    boot.document.getElementById('send').addEventListener('click', () => clicks++)
    boot.document.getElementById('astcmd').value = 'core show channels'
    boot.document.querySelector('.onRepeat').click()
    return () => clicks
  }
  const setHidden = (document, value) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value })
    document.dispatchEvent(new document.defaultView.Event('visibilitychange'))
  }

  test('focus in #astcmd stops the interval, resets the bar and shows the pause label', () => {
    const boot = bootDOM()
    const { document, pendingIntervals } = boot
    startRepeat(boot)
    expect(pendingIntervals()).toHaveLength(1)

    document.getElementById('astcmd').focus()
    expect(pendingIntervals()).toHaveLength(0)
    const btn = document.querySelector('.onRepeat')
    expect(btn.classList.contains('paused')).toBe(true)
    expect(btn.innerText).toBe('Пауза — курсор у полі CLI')
    expect(document.querySelector('.repeatProgress-fill').style.width).toBe('0%')
  })

  test('blur resumes with a fresh countdown and does NOT send immediately', () => {
    const boot = bootDOM()
    const { document, pendingIntervals } = boot
    const clicks = startRepeat(boot)
    const cli = document.getElementById('astcmd')
    cli.focus()
    cli.value = 'confbridge list 5500' // користувач набрав нову команду
    cli.blur()

    expect(clicks()).toBe(0)
    const intervals = pendingIntervals()
    expect(intervals).toHaveLength(1)
    expect(intervals[0].ms).toBe(5000)
    expect(document.querySelector('.onRepeat').innerText).toBe('Перестати повторювати')
    expect(document.querySelector('.onRepeat').classList.contains('paused')).toBe(false)

    intervals[0].fn()
    expect(clicks()).toBe(1)
    expect(astcmd(document)).toBe('confbridge list 5500')
  })

  test('safety net: a tick that fires while the CLI has focus sends nothing', () => {
    const boot = bootDOM()
    const { document, pendingIntervals } = boot
    const clicks = startRepeat(boot)
    const tick = pendingIntervals()[0].fn
    // Подію focus «пропустили»: фокус є, а повтор про це не знає.
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => document.getElementById('astcmd') })
    tick()
    expect(clicks()).toBe(0)
    expect(document.querySelector('.onRepeat').classList.contains('paused')).toBe(true)
  })

  test('hidden tab pauses; visible again sends at once (data is stale) and restarts', () => {
    const boot = bootDOM()
    const { document, pendingIntervals } = boot
    const clicks = startRepeat(boot)

    setHidden(document, true)
    expect(pendingIntervals()).toHaveLength(0)
    expect(document.querySelector('.onRepeat').innerText).toBe('Пауза — вкладка прихована')

    setHidden(document, false)
    expect(clicks()).toBe(1)
    expect(pendingIntervals()).toHaveLength(1)
    expect(document.querySelector('.onRepeat').innerText).toBe('Перестати повторювати')
  })

  test('back from hidden: a destructive command in the CLI is not re-sent', () => {
    const boot = bootDOM()
    const { document } = boot
    const clicks = startRepeat(boot)
    document.getElementById('astcmd').value = 'confbridge kick   5500   all'
    setHidden(document, true)
    setHidden(document, false)
    expect(clicks()).toBe(0)
  })

  test('the stepper while paused changes the label value but starts no interval', () => {
    const boot = bootDOM()
    const { document, pendingIntervals } = boot
    startRepeat(boot)
    document.getElementById('astcmd').focus()
    document.querySelector('.repeatPlus').click()
    expect(pendingIntervals()).toHaveLength(0)
    document.getElementById('astcmd').blur()
    expect(pendingIntervals()[0].ms).toBe(6000)
  })

  test('stopping while paused clears the pause; focus/visibility do nothing when repeat is off', () => {
    const boot = bootDOM()
    const { document, pendingIntervals } = boot
    startRepeat(boot)
    const cli = document.getElementById('astcmd')
    cli.focus()
    document.querySelector('.onRepeat').click() // стоп
    const btn = document.querySelector('.onRepeat')
    expect(btn.classList.contains('paused')).toBe(false)
    expect(btn.innerText).toBe('Відправляти раз в 5 секунд')

    cli.blur()
    setHidden(document, true)
    setHidden(document, false)
    expect(pendingIntervals()).toHaveLength(0)
  })
})

describe('manifest.json', () => {
  test('no unused / invalid permissions — the content script needs none', async () => {
    const fs = await import('node:fs')
    const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'))
    expect(manifest.permissions).toBeUndefined()
    expect(manifest.host_permissions).toBeUndefined()
    expect(manifest.content_scripts[0].js).toEqual(['utils.js', 'main.js'])
  })
})

describe('highlight', () => {
  test('the input + clear button + label exist in the panel', () => {
    const { document } = bootDOM()
    expect(document.getElementById('highlightInput')).not.toBeNull()
    expect(document.querySelector('.clearHighlight')).not.toBeNull()
    expect(document.querySelector('.highlightRow label[for="highlightInput"]')).not.toBeNull()
  })

  test('typing in highlight input wraps every match in <mark.lazy-highlight>', () => {
    const { window, document } = bootDOM()
    const input = document.getElementById('highlightInput')
    const pres = document.querySelectorAll('pre')
    pres[2].textContent = 'SIP/200-abc\nSIP/201-def\nSIP/202-ghi\n'

    input.value = '20'
    input.dispatchEvent(new window.Event('input'))

    const marks = pres[2].querySelectorAll('mark.lazy-highlight')
    // 200, 201, 202 each contain "20" once
    expect(marks).toHaveLength(3)
    marks.forEach((m) => expect(m.textContent).toBe('20'))
  })

  test('clearing the input restores original text (no leftover marks)', () => {
    const { window, document } = bootDOM()
    const input = document.getElementById('highlightInput')
    const pres = document.querySelectorAll('pre')
    pres[2].textContent = 'SIP/200-abc\n'

    input.value = '200'
    input.dispatchEvent(new window.Event('input'))
    expect(pres[2].querySelectorAll('mark.lazy-highlight')).toHaveLength(1)

    input.value = ''
    input.dispatchEvent(new window.Event('input'))
    expect(pres[2].querySelectorAll('mark.lazy-highlight')).toHaveLength(0)
    expect(pres[2].textContent).toBe('SIP/200-abc\n')
  })

  test('clear button (×) empties the input and removes highlights', () => {
    const { window, document } = bootDOM()
    const input = document.getElementById('highlightInput')
    const pres = document.querySelectorAll('pre')
    pres[2].textContent = 'SIP/200-abc\n'

    input.value = '200'
    input.dispatchEvent(new window.Event('input'))
    expect(pres[2].querySelectorAll('mark.lazy-highlight')).toHaveLength(1)

    document.querySelector('.clearHighlight').click()
    expect(input.value).toBe('')
    expect(pres[2].querySelectorAll('mark.lazy-highlight')).toHaveLength(0)
  })

  test('matching is case-insensitive', () => {
    const { window, document } = bootDOM()
    const input = document.getElementById('highlightInput')
    const pres = document.querySelectorAll('pre')
    pres[2].textContent = 'SIP/200-abc\nsip/201-def\n'

    input.value = 'sip'
    input.dispatchEvent(new window.Event('input'))
    expect(pres[2].querySelectorAll('mark.lazy-highlight')).toHaveLength(2)
  })

  test('regex metacharacters in input are escaped', () => {
    const { window, document } = bootDOM()
    const input = document.getElementById('highlightInput')
    const pres = document.querySelectorAll('pre')
    pres[2].textContent = 'foo (bar) baz\n'

    input.value = '(bar)'
    input.dispatchEvent(new window.Event('input'))
    const marks = pres[2].querySelectorAll('mark.lazy-highlight')
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toBe('(bar)')
  })

  test('re-applies highlight when the <pre> NODE itself is replaced (the real FreePBX repeat bug)', async () => {
    const { window, document } = bootDOM()
    const input = document.getElementById('highlightInput')
    const pres = document.querySelectorAll('pre')

    input.value = '200'
    input.dispatchEvent(new window.Event('input'))

    // FreePBX does NOT mutate textContent — it swaps the whole <pre> for a fresh node
    // (e.g. container.innerHTML = response). An observer bound to the old node would die here.
    const oldPre = pres[2]
    const newPre = document.createElement('pre')
    newPre.textContent = 'After repeat: SIP/200-zzz at 09:20:00\n'
    oldPre.parentNode.replaceChild(newPre, oldPre)

    await new Promise((r) => setTimeout(r, 0))

    // The observer (on document.body) must catch the node swap and highlight the NEW pre.
    const fresh = document.querySelectorAll('pre')[2]
    expect(fresh).toBe(newPre)
    const marks = fresh.querySelectorAll('mark.lazy-highlight')
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toBe('200')
  })

  test('MutationObserver re-applies highlight when pre[2] is rewritten (simulates the 5s repeat)', async () => {
    const { window, document } = bootDOM()
    const input = document.getElementById('highlightInput')
    const pres = document.querySelectorAll('pre')

    input.value = '200'
    input.dispatchEvent(new window.Event('input'))

    // Simulate FreePBX server replacing pre[2] (e.g. after the repeat-interval re-click).
    pres[2].textContent = 'New: SIP/200-xyz at 09:15:01\n'

    // MutationObserver callbacks are scheduled as microtasks. Drain by yielding.
    await new Promise((r) => setTimeout(r, 0))

    const marks = pres[2].querySelectorAll('mark.lazy-highlight')
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toBe('200')
  })

  test('loadOneConf with active highlight produces clean kick buttons (data-sip not corrupted by <mark> tags)', async () => {
    const { window, document } = bootDOM()
    const input = document.getElementById('highlightInput')
    const pres = document.querySelectorAll('pre')

    // Highlight is active BEFORE drill-in.
    input.value = '200'
    input.dispatchEvent(new window.Event('input'))

    window.loadOneConf('5500')
    // FreePBX response that already contains highlight <mark>s. refreshOutput must unwrap them
    // BEFORE injecting buttons — otherwise the regex would capture the tag into data-sip.
    pres[2].innerHTML =
      'User: SIP/<mark class="lazy-highlight">200</mark>-abc ringing\n' +
      'User: SIP/201-def talking\n'
    await tick()

    const kickBtns = pres[2].querySelectorAll('.generated-kick-btn')
    expect(kickBtns).toHaveLength(2)
    // Critical: data-sip must be the clean SIP id, not "SIP/<mark...>200</mark>-abc"
    expect(kickBtns[0].dataset.sip).toBe('SIP/200-abc')
    expect(kickBtns[1].dataset.sip).toBe('SIP/201-def')
  })

  test('showCallsDetailed with active highlight produces clean hangup buttons (data-sip not corrupted)', async () => {
    const { window, document } = bootDOM()
    const input = document.getElementById('highlightInput')
    const pres = document.querySelectorAll('pre')

    input.value = '200'
    input.dispatchEvent(new window.Event('input'))

    window.showCallsDetailed()
    pres[2].innerHTML =
      'Channel: SIP/<mark class="lazy-highlight">200</mark>-001 Up\n' +
      'Channel: SIP/201-002 Up\n'
    await tick()

    const hangups = pres[2].querySelectorAll('.generated-hangup-btn')
    expect(hangups).toHaveLength(2)
    expect(hangups[0].dataset.sip).toBe('SIP/200-001')
    expect(hangups[1].dataset.sip).toBe('SIP/201-002')
  })
})

describe('showCallsDetailed', () => {
  test('adds a hangup button before every channel in pre[2]', async () => {
    const { window, document } = bootDOM()

    window.showCallsDetailed()
    respond(document, 'SIP/200-001 from-internal Up\nPJSIP/201-002 from-internal Up\n')
    await tick()

    const hangups = document.querySelectorAll('pre')[2].querySelectorAll('.generated-hangup-btn')
    expect(hangups).toHaveLength(2)
    expect(hangups[0].dataset.sip).toBe('SIP/200-001')
    expect(hangups[1].dataset.sip).toBe('PJSIP/201-002')
  })

  test('clicking hangup sends "channel request hangup  <chan>", then re-reads the calls', async () => {
    const { window, document, flushTimeouts } = bootDOM()

    window.showCallsDetailed()
    respond(document, 'SIP/200-001 from-internal Up\n')
    await tick()

    document.querySelectorAll('pre')[2].querySelector('.generated-hangup-btn').click()
    expect(astcmd(document)).toBe('channel request hangup  SIP/200-001   ')

    respond(document, 'Requested Hangup on channel SIP/200-001')
    await tick()
    flushTimeouts() // settle
    await tick()
    expect(astcmd(document)).toBe('core show channels verbose      ')
  })

  test('plain "core show channels" (showCalls) stays without buttons', async () => {
    const { window, document } = bootDOM()
    window.showCalls()
    respond(document, 'SIP/200-001 200@from-internal:1 Up\n')
    await tick()
    expect(document.querySelectorAll('pre')[2].querySelectorAll('button')).toHaveLength(0)
  })
})

describe('dial into conference (channel originate)', () => {
  const loadConfs = async () => {
    const boot = bootDOM()
    boot.window.loadAllConfs()
    respond(boot.document, confList(confRow('5500', 2), confRow('5501', 1)))
    await tick()
    return boot
  }
  const pick = (window, document, conf) => {
    const select = document.querySelector('.ext-output select')
    select.value = conf
    select.dispatchEvent(new window.Event('change'))
  }

  test('the dial input + button appear next to the conference dropdown', async () => {
    const { document } = await loadConfs()
    expect(document.querySelector('.ext-output #dialInput')).not.toBeNull()
    expect(document.querySelector('.ext-output .dialToConf')).not.toBeNull()
  })

  test('dials the number via Local/…@from-internal into the SELECTED conference, then re-reads it', async () => {
    const { window, document, pendingTimeouts, flushTimeouts } = await loadConfs()
    pick(window, document, '5501')
    respond(document, 'SIP/300-abc   default_user\n')
    await tick()

    document.getElementById('dialInput').value = '210'
    document.querySelector('.dialToConf').click()
    expect(astcmd(document)).toBe('channel originate  Local/210@from-internal  extension 5501@from-internal')
    expect(document.querySelector('.confStatus').textContent).toContain('210')

    // originate нічого не друкує — відповіді не чекаємо, лише коротку паузу
    expect(pendingTimeouts().map((t) => t.ms)).toContain(1000)
    flushTimeouts()
    await tick()
    expect(astcmd(document)).toBe('confbridge list   5501   ')
  })

  test('Enter in the dial input dials too', async () => {
    const { window, document } = await loadConfs()
    pick(window, document, '5500')
    const input = document.getElementById('dialInput')
    input.value = '211'
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }))
    expect(astcmd(document)).toBe('channel originate  Local/211@from-internal  extension 5500@from-internal')
  })

  test('spaces, dashes and brackets are stripped from an external number', async () => {
    const { window, document } = await loadConfs()
    pick(window, document, '5500')
    document.getElementById('dialInput').value = ' (067) 123-45-67 '
    document.querySelector('.dialToConf').click()
    expect(astcmd(document)).toBe('channel originate  Local/0671234567@from-internal  extension 5500@from-internal')
  })

  test('a pasted channel is reduced to the number', async () => {
    const { window, document } = await loadConfs()
    pick(window, document, '5500')
    document.getElementById('dialInput').value = 'PJSIP/212-0000001a'
    document.querySelector('.dialToConf').click()
    expect(astcmd(document)).toBe('channel originate  Local/212@from-internal  extension 5500@from-internal')
  })

  test('no conference selected → nothing is sent, status explains', async () => {
    const { document } = await loadConfs()
    document.getElementById('dialInput').value = '210'
    document.querySelector('.dialToConf').click()
    expect(astcmd(document)).toBe('confbridge list      ')
    expect(document.querySelector('.confStatus').textContent).toMatch(/оберіть конференцію/i)
  })

  test.each(['', 'abc', '210 extension 9999@x', '2'])('invalid number "%s" → nothing is sent', async (value) => {
    const { window, document } = await loadConfs()
    pick(window, document, '5500')
    document.getElementById('dialInput').value = value
    document.querySelector('.dialToConf').click()
    expect(astcmd(document)).toBe('confbridge list   5500   ')
    expect(document.querySelector('.confStatus').textContent).toMatch(/лише цифри/)
  })

  test('a half-typed number survives a refresh of the conference list', async () => {
    const { window, document } = await loadConfs()
    document.getElementById('dialInput').value = '21'
    window.loadAllConfs()
    respond(document, confList(confRow('5500', 2)))
    await tick()
    expect(document.getElementById('dialInput').value).toBe('21')
  })
})

describe('clickable channels and numbers in the output', () => {
  const show = async (text) => {
    const boot = bootDOM()
    boot.window.showCalls()
    respond(boot.document, text)
    await tick()
    return boot
  }
  const tokens = (document) =>
    [...document.querySelectorAll('pre')[2].querySelectorAll('.lazy-token')].map((t) => t.dataset.value)

  test('channels and stand-alone numbers become tokens; ports, times, IPs and counts do not', async () => {
    const { document } = await show([
      'PJSIP/200-0000001a  200@from-internal:1  Up  00:01:23',
      'Local/300@from-internal-00000002;1  "Bob" <301>',
      '  Contact:  201/sips:201@192.168.0.51:5061;transport=TLS  12.345',
      '2 active channels',
    ].join('\n'))
    expect(tokens(document)).toEqual([
      'PJSIP/200-0000001a', '200',
      'Local/300@from-internal-00000002;1', '301',
      '201',
    ])
  })

  test('tokens do not change the text (columns stay aligned)', async () => {
    const text = 'PJSIP/200-0000001a  200@from-internal:1  Up\n'
    const { document } = await show(text)
    expect(document.querySelectorAll('pre')[2].textContent).toBe(text)
  })

  test('kick buttons keep clean data-sip and every channel is still a token', async () => {
    const { window, document } = bootDOM()
    window.loadOneConf('5500')
    respond(document, 'PJSIP/200-0000001a   default_user   200\nSIP/201-def   default_user   201\n')
    await tick()
    const pre = document.querySelectorAll('pre')[2]
    expect([...pre.querySelectorAll('.generated-kick-btn')].map((b) => b.dataset.sip))
      .toEqual(['PJSIP/200-0000001a', 'SIP/201-def'])
    expect(tokens(document)).toEqual(['PJSIP/200-0000001a', '200', 'SIP/201-def', '201'])
    // підсумок і кнопки — не токени
    expect(pre.querySelector('.lazy-decor .lazy-token')).toBeNull()
  })

  test('tokens are added once — no nesting on later refreshes', async () => {
    const { window, document } = await show('PJSIP/200-0000001a  200@from-internal:1\n')
    const input = document.getElementById('highlightInput')
    input.value = '200'
    input.dispatchEvent(new window.Event('input'))
    input.value = ''
    input.dispatchEvent(new window.Event('input'))
    expect(tokens(document)).toEqual(['PJSIP/200-0000001a', '200'])
    expect(document.querySelector('.lazy-token .lazy-token')).toBeNull()
  })

  test('highlight still works inside tokens', async () => {
    const { window, document } = await show('PJSIP/200-0000001a  200@from-internal:1\n')
    const input = document.getElementById('highlightInput')
    input.value = '200'
    input.dispatchEvent(new window.Event('input'))
    expect(document.querySelectorAll('mark.lazy-highlight')).toHaveLength(2)
  })

  test('clicking a channel opens a menu; "Номер" puts the PEER NAME into the peer input', async () => {
    const { document } = await show('PJSIP/200-0000001a  Up\n')
    document.querySelector('.lazy-token').click()
    const menu = document.querySelector('.lazyTokenMenu')
    expect(menu).not.toBeNull()
    expect(menu.querySelector('.lazyTokenMenu-title').textContent).toBe('PJSIP/200-0000001a')

    menu.querySelector('[data-action="peer"]').click()
    expect(document.getElementById('peerInput').value).toBe('200')
    expect(document.activeElement).toBe(document.getElementById('peerInput'))
    expect(document.querySelector('.lazyTokenMenu')).toBeNull()
    // нічого не надіслано — лише підставлено
    expect(astcmd(document)).toBe('core show channels      ')
  })

  test('"Підсвітити" puts the clicked value into the highlight input and highlights it', async () => {
    const { document } = await show('PJSIP/200-0000001a  Up\nPJSIP/201-0000001b  Up\n')
    document.querySelectorAll('.lazy-token')[1].click()
    document.querySelector('.lazyTokenMenu [data-action="highlight"]').click()
    expect(document.getElementById('highlightInput').value).toBe('PJSIP/201-0000001b')
    const marks = document.querySelectorAll('mark.lazy-highlight')
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toBe('PJSIP/201-0000001b')
  })

  test('a Local/ channel is reduced to its number for the peer input', async () => {
    const { document } = await show('Local/300@from-internal-00000002;1  Up\n')
    document.querySelector('.lazy-token').click()
    document.querySelector('.lazyTokenMenu [data-action="peer"]').click()
    expect(document.getElementById('peerInput').value).toBe('300')
  })

  test('a plain number goes to the peer input as is', async () => {
    const { document } = await show('Endpoint:  205/205   Not in use\n')
    document.querySelector('.lazy-token').click()
    document.querySelector('.lazyTokenMenu [data-action="peer"]').click()
    expect(document.getElementById('peerInput').value).toBe('205')
  })

  test('only one menu at a time; a click elsewhere or Escape closes it', async () => {
    const { window, document } = await show('PJSIP/200-0000001a  200@from-internal:1\n')
    const [a, b] = document.querySelectorAll('.lazy-token')
    a.click()
    b.click()
    expect(document.querySelectorAll('.lazyTokenMenu')).toHaveLength(1)
    expect(document.querySelector('.lazyTokenMenu-title').textContent).toBe('200')

    document.body.click()
    expect(document.querySelector('.lazyTokenMenu')).toBeNull()

    a.click()
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.querySelector('.lazyTokenMenu')).toBeNull()
  })
})
