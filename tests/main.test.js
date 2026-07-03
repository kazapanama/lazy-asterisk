import { describe, test, expect } from 'vitest'
import { bootDOM } from './helpers.js'

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

  test('kickOne sends the kick and schedules loadOneConf after 2000 ms', () => {
    const { window, document, pendingTimeouts } = bootDOM()
    window.kickOne('5500', 'SIP/200-abc')
    expect(document.getElementById('astcmd').value).toBe('confbridge kick   5500  SIP/200-abc')
    const pending = pendingTimeouts()
    expect(pending).toHaveLength(1)
    expect(pending[0].ms).toBe(2000)
  })
})

describe('peer / call query helpers', () => {
  test('showPeerInfo → "sip show peer  <sip>"', () => {
    const { window, document } = bootDOM()
    window.showPeerInfo('200')
    expect(document.getElementById('astcmd').value).toBe('sip show peer  200   ')
  })

  test('unregisterPeer → "sip unregister  <sip>"', () => {
    const { window, document } = bootDOM()
    window.unregisterPeer('200')
    expect(document.getElementById('astcmd').value).toBe('sip unregister  200   ')
  })

  test('showCalls → "core show channels"', () => {
    const { window, document } = bootDOM()
    window.showCalls()
    expect(document.getElementById('astcmd').value).toBe('core show channels      ')
  })
})

describe('peer row (sip show peer / sip unregister)', () => {
  test('the row exists: input + info + unregister; the dead "1 номер" button is gone', () => {
    const { document } = bootDOM()
    expect(document.getElementById('peerInput')).not.toBeNull()
    expect(document.querySelector('.peerInfo')).not.toBeNull()
    expect(document.querySelector('.peerUnregister')).not.toBeNull()
    expect(document.querySelector('.peerRow label[for="peerInput"]')).not.toBeNull()
    expect(document.querySelector('.loadExtensions')).toBeNull()
  })

  test('clicking "Інфо про номер" sends sip show peer for the typed number', () => {
    const { document } = bootDOM()
    document.getElementById('peerInput').value = '200'
    document.querySelector('.peerInfo').click()
    expect(document.getElementById('astcmd').value).toBe('sip show peer  200   ')
  })

  test('clicking "Розреєструвати" sends sip unregister for the typed number', () => {
    const { document } = bootDOM()
    document.getElementById('peerInput').value = '200'
    document.querySelector('.peerUnregister').click()
    expect(document.getElementById('astcmd').value).toBe('sip unregister  200   ')
  })

  test('a pasted channel name SIP/200-000000a3 is reduced to the peer name 200', () => {
    const { document } = bootDOM()
    document.getElementById('peerInput').value = 'SIP/200-000000a3'
    document.querySelector('.peerInfo').click()
    expect(document.getElementById('astcmd').value).toBe('sip show peer  200   ')
  })

  test('input is trimmed; a peer typed WITHOUT SIP/ prefix keeps its dashes intact', () => {
    const { document } = bootDOM()
    document.getElementById('peerInput').value = '  office-2  '
    document.querySelector('.peerInfo').click()
    expect(document.getElementById('astcmd').value).toBe('sip show peer  office-2   ')
  })

  test('empty input: neither button sends anything', () => {
    const { document } = bootDOM()
    document.getElementById('peerInput').value = '   '
    document.querySelector('.peerInfo').click()
    document.querySelector('.peerUnregister').click()
    expect(document.getElementById('astcmd').value).toBe('')
  })

  test('Enter inside the input triggers the safe action (sip show peer)', () => {
    const { window, document } = bootDOM()
    const input = document.getElementById('peerInput')
    input.value = '201'
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }))
    expect(document.getElementById('astcmd').value).toBe('sip show peer  201   ')
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
  test('renders a select with every conference number found in pre[2]', () => {
    const { window, document, flushTimeouts } = bootDOM()
    const pres = document.querySelectorAll('pre')
    pres[2].textContent = [
      'Conference Bridge Name    Users  Marked  Locked  Muted',
      '============================ ===== ======= ======= =====',
      '5500                          3      0       No      No',
      '5501                          2      0       No      No',
    ].join('\n')

    window.loadAllConfs()
    flushTimeouts()

    const select = document.querySelector('.ext-output select')
    expect(select).not.toBeNull()
    const options = select.querySelectorAll('option')
    // placeholder + 2 confs
    expect(options).toHaveLength(3)
    expect(options[0].text).toBe('Оберіть конференцію')
    expect(options[1].value).toBe('5500')
    expect(options[2].value).toBe('5501')
  })

  test('shows a warning paragraph when no conferences are active', () => {
    const { window, document, flushTimeouts } = bootDOM()
    const pres = document.querySelectorAll('pre')
    pres[2].textContent = 'No active conferences.'

    window.loadAllConfs()
    flushTimeouts()

    const warning = document.querySelector('.ext-output p')
    expect(warning).not.toBeNull()
    expect(warning.innerText).toMatch(/немає конференцій/)
  })

  test('pressing the button repeatedly with no conferences keeps exactly ONE warning', () => {
    const { window, document, flushTimeouts } = bootDOM()
    const pres = document.querySelectorAll('pre')
    pres[2].textContent = 'No active conferences.'

    window.loadAllConfs()
    flushTimeouts()
    window.loadAllConfs()
    flushTimeouts()
    window.loadAllConfs()
    flushTimeouts()

    expect(document.querySelectorAll('.ext-output p')).toHaveLength(1)
  })

  test('empty → confs appear: the warning is replaced by the select (no leftovers)', () => {
    const { window, document, flushTimeouts } = bootDOM()
    const pres = document.querySelectorAll('pre')

    pres[2].textContent = 'No active conferences.'
    window.loadAllConfs()
    flushTimeouts()
    expect(document.querySelectorAll('.ext-output p')).toHaveLength(1)

    pres[2].textContent = '5500\n'
    window.loadAllConfs()
    flushTimeouts()
    expect(document.querySelectorAll('.ext-output p')).toHaveLength(0)
    expect(document.querySelectorAll('.ext-output select')).toHaveLength(1)
  })

  test('confs disappear: the select is replaced by a single warning', () => {
    const { window, document, flushTimeouts } = bootDOM()
    const pres = document.querySelectorAll('pre')

    pres[2].textContent = '5500\n'
    window.loadAllConfs()
    flushTimeouts()
    expect(document.querySelectorAll('.ext-output select')).toHaveLength(1)

    pres[2].textContent = 'No active conferences.'
    window.loadAllConfs()
    flushTimeouts()
    expect(document.querySelectorAll('.ext-output select')).toHaveLength(0)
    expect(document.querySelectorAll('.ext-output p')).toHaveLength(1)
  })

  test('changing the select triggers loadOneConf with the chosen conf', () => {
    const { window, document, flushTimeouts } = bootDOM()
    const pres = document.querySelectorAll('pre')
    pres[2].textContent = '5500\n5501\n'

    window.loadAllConfs()
    flushTimeouts()

    const select = document.querySelector('.ext-output select')
    // pick conf 5501
    select.value = '5501'
    select.dispatchEvent(new window.Event('change'))

    // loadOneConf clears pre[2] and immediately calls sendQuery('confbridge list ', '5501')
    expect(document.getElementById('astcmd').value).toBe('confbridge list   5501   ')
  })
})

describe('loadOneConf', () => {
  test('inlines a kick button before every SIP id and appends a KICK ALL button', () => {
    const { window, document, flushTimeouts } = bootDOM()
    const pres = document.querySelectorAll('pre')

    window.loadOneConf('5500')
    // loadOneConf clears pre[2] first; simulate FreePBX populating it before timeout fires
    pres[2].innerHTML = [
      'Conference 5500',
      'User: SIP/200-abc ringing',
      'User: SIP/201-def talking',
      '',
    ].join('\n')
    flushTimeouts()

    const kickBtns = pres[2].querySelectorAll('.generated-kick-btn')
    expect(kickBtns).toHaveLength(2)
    expect(kickBtns[0].dataset.sip).toBe('SIP/200-abc')
    expect(kickBtns[1].dataset.sip).toBe('SIP/201-def')

    // KICK ALL is uniquely styled red — the inline kick buttons have no color style
    const kickAll = Array.from(pres[2].querySelectorAll('button')).find(
      (b) => b.style.color === 'red',
    )
    expect(kickAll).toBeDefined()
    expect(kickAll.innerText).toBe('ВИКИНУТИ ВСІХ')
  })

  test('clicking an inline kick button calls kickOne for that SIP/conf pair', () => {
    const { window, document, flushTimeouts } = bootDOM()
    const pres = document.querySelectorAll('pre')

    window.loadOneConf('5500')
    pres[2].innerHTML = 'User: SIP/200-abc ringing\n'
    flushTimeouts()

    pres[2].querySelector('.generated-kick-btn').click()
    expect(document.getElementById('astcmd').value).toBe('confbridge kick   5500  SIP/200-abc')
  })

  test('clicking KICK ALL sends "confbridge kick   <conf>   all"', () => {
    const { window, document, flushTimeouts } = bootDOM()
    const pres = document.querySelectorAll('pre')

    window.loadOneConf('5500')
    pres[2].innerHTML = 'User: SIP/200-abc ringing\n'
    flushTimeouts()

    const kickAll = Array.from(pres[2].querySelectorAll('button')).find(
      (b) => b.style.color === 'red',
    )
    kickAll.click()
    // Same string as the standalone kickAll test
    expect(document.getElementById('astcmd').value).toBe('confbridge kick   5500   all')
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

  test('loadOneConf with active highlight produces clean kick buttons (data-sip not corrupted by <mark> tags)', () => {
    const { window, document, flushTimeouts } = bootDOM()
    const input = document.getElementById('highlightInput')
    const pres = document.querySelectorAll('pre')

    // Highlight is active BEFORE drill-in.
    input.value = '200'
    input.dispatchEvent(new window.Event('input'))

    window.loadOneConf('5500')
    // Simulate FreePBX response: write raw text, then PRE-WRAP with <mark> to mimic the
    // race where the observer's highlight fires BEFORE the extension's 1s setTimeout body.
    // If unwrapHighlights() in loadOneConf weren't there, the regex would capture the tag.
    pres[2].innerHTML =
      'User: SIP/<mark class="lazy-highlight">200</mark>-abc ringing\n' +
      'User: SIP/201-def talking\n'
    flushTimeouts()

    const kickBtns = pres[2].querySelectorAll('.generated-kick-btn')
    expect(kickBtns).toHaveLength(2)
    // Critical: data-sip must be the clean SIP id, not "SIP/<mark...>200</mark>-abc"
    expect(kickBtns[0].dataset.sip).toBe('SIP/200-abc')
    expect(kickBtns[1].dataset.sip).toBe('SIP/201-def')
  })

  test('showCallsDetailed with active highlight produces clean hangup buttons (data-sip not corrupted)', () => {
    const { window, document, flushTimeouts } = bootDOM()
    const input = document.getElementById('highlightInput')
    const pres = document.querySelectorAll('pre')

    input.value = '200'
    input.dispatchEvent(new window.Event('input'))

    window.showCallsDetailed()
    pres[2].innerHTML =
      'Channel: SIP/<mark class="lazy-highlight">200</mark>-001 Up\n' +
      'Channel: SIP/201-002 Up\n'
    flushTimeouts()

    const hangups = pres[2].querySelectorAll('.generated-hangup-btn')
    expect(hangups).toHaveLength(2)
    expect(hangups[0].dataset.sip).toBe('SIP/200-001')
    expect(hangups[1].dataset.sip).toBe('SIP/201-002')
  })
})

describe('showCallsDetailed', () => {
  test('adds a hangup button before every SIP channel in pre[2]', () => {
    const { window, document, flushTimeouts } = bootDOM()

    window.showCallsDetailed()
    // simulate what FreePBX would render after the command runs
    const pres = document.querySelectorAll('pre')
    pres[2].innerHTML = 'Channel: SIP/200-001 Up\nChannel: SIP/201-002 Up\n'

    flushTimeouts()

    const hangups = pres[2].querySelectorAll('.generated-hangup-btn')
    expect(hangups).toHaveLength(2)
    expect(hangups[0].dataset.sip).toBe('SIP/200-001')
    expect(hangups[1].dataset.sip).toBe('SIP/201-002')
  })

  test('clicking a hangup button sends "channel request hangup  <sip>"', () => {
    const { window, document, flushTimeouts } = bootDOM()

    window.showCallsDetailed()
    const pres = document.querySelectorAll('pre')
    pres[2].innerHTML = 'Channel: SIP/200-001 Up\n'
    flushTimeouts()

    pres[2].querySelector('.generated-hangup-btn').click()
    expect(document.getElementById('astcmd').value).toBe('channel request hangup  SIP/200-001   ')
  })
})
