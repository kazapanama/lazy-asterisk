import { describe, test, expect } from 'vitest'
import { bootDOM } from './helpers.js'

describe('sendQuery (utils.js)', () => {
  test('packs command, number and optional with two-space separators', () => {
    const { window, document } = bootDOM()
    window.sendQuery('confbridge kick ', '5500', 'all')
    // 'confbridge kick ' + '  ' + '5500' + '  ' + 'all'
    expect(document.getElementById('astcmd').value).toBe('confbridge kick   5500  all')
  })

  test('defaults missing number and optional arguments to a single space', () => {
    const { window, document } = bootDOM()
    window.sendQuery('core show channels')
    // 'core show channels' + '  ' + ' ' + '  ' + ' '  →  6 trailing spaces
    expect(document.getElementById('astcmd').value).toBe('core show channels      ')
  })

  test('clicks the FreePBX send button', () => {
    const { window, document } = bootDOM()
    let clicks = 0
    document.getElementById('send').addEventListener('click', () => clicks++)
    window.sendQuery('foo')
    expect(clicks).toBe(1)
  })
})
