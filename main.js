
const inputCLI = document.getElementById('astcmd')
const buttonCLI = document.querySelector('#send')

let outputDiv
let tmp

let isOnRepeat = false
let repeater
let repeatButton

let highlightInput
let outputObserver

let repeatProgress
let repeatProgressFill
let repeatSeconds = 5

// Остання надіслана в CLI команда, нормалізована (див. normalizeCommand).
// Оновлюється на КОЖНЕ надсилання: наше, ручне чи з інтервалу повтору.
// За нею observer вирішує, які кнопки вставити у вивід, а sendAndWait
// перевіряє, чи відповідь, яку він чекає, ще «наша».
let lastSentCommand = ''

// Конференція, відкрита в dropdown. Зберігаємо вибір під час оновлення списку.
let selectedConf = ''

// Ім'я каналу: PJSIP/200-0000001a, SIP/200-000000a3, Local/200@from-internal-0001;1 …
// \b не дає зачепити "SIP/" всередині "PJSIP/". Раніше кнопка отримувала SIP/200-…,
// і kick/hangup відповідали «channel not found».
const CHANNEL_REGEX = /\b((?:PJSIP|SIP|IAX2|DAHDI|Local)\/[^\s]+)/

// Пауза після kick/hangup перед перечитуванням списку: CLI відповідає одразу, а канал
// виходить з мосту асинхронно. Якщо перечитати миттєво, викинутий ще буде у списку.
const SETTLE_MS = 500

// «ВИКИНУТИ ВСІХ» спрацьовує лише з другого кліку, зробленого протягом цього часу.
const KICK_ALL_CONFIRM_MS = 4000

// Конференція, для якої «ВИКИНУТИ ВСІХ» уже натиснули один раз. Тримаємо стан тут, а не
// в кнопці: у режимі повтору FreePBX кожні N секунд перемальовує вивід, і кнопка
// створюється заново. Якби стан жив у DOM, другий клік лише «озброював» би нову кнопку.
let kickAllArmedConf = ''
let kickAllArmTimer

// Контекст FreePBX, через який набираємо абонента і заводимо його в конференцію.
const DIAL_CONTEXT = 'from-internal'

// channel originate нічого не друкує, тож чекати відповіді нема на що. Даємо FreePBX
// секунду на запит і повертаємо в CLI перегляд конференції.
const ORIGINATE_SETTLE_MS = 1000

// Клікабельний номер у виводі: 3–15 цифр (можна з +), що стоїть окремим словом.
// Не чіпає порти (":50001"), час ("00:01:23"), IP ("192.168."), хвіст каналу ("/200-").
const NUMBER_TOKEN = String.raw`(?<![^\s<"(\[])\+?\d{3,15}(?![^\s>")\]/@,;])`
const TOKEN_REGEX = new RegExp(`${CHANNEL_REGEX.source}|${NUMBER_TOKEN}`, 'g')




function normalizeCommand(cmd) {
    return cmd.replace(/\s+/g, ' ').trim()
}

// Команди, які режим повтору НІКОЛИ не надсилає повторно. Інакше «ВИКИНУТИ ВСІХ»
// у live-режимі викидав би кожного, хто заходить, кожні N секунд, а «Набрати» дзвонив би
// абоненту знову й знову.
function isDestructiveCommand(cmd) {
    return /^(confbridge kick|channel request hangup|channel originate)\b/.test(normalizeCommand(cmd))
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

//kick all
// Після kick all конференція зникає, тому оновлюємо весь список (і dropdown).
async function kickAll(confNumber) {
    await sendAndWait('confbridge kick ', confNumber, ' all')
    await delay(SETTLE_MS)
    loadAllConfs()
}

//kick one extension
// Перечитуємо конференцію ЗАВЖДИ, навіть якщо відповіді на kick не дочекалися:
// так у #astcmd повертається команда перегляду, і повтор продовжує показувати список.
async function kickOne(confNumber, channel) {
    await sendAndWait('confbridge kick ', confNumber, channel)
    await delay(SETTLE_MS)
    loadOneConf(confNumber)
}

// Перший клік «озброює» кнопку на KICK_ALL_CONFIRM_MS, другий викидає всіх.
function onKickAllClick(confNumber) {
    if (kickAllArmedConf === confNumber) {
        disarmKickAll()
        kickAll(confNumber)
        return
    }
    kickAllArmedConf = confNumber
    clearTimeout(kickAllArmTimer)
    kickAllArmTimer = setTimeout(disarmKickAll, KICK_ALL_CONFIRM_MS)
    document.querySelectorAll('.lazy-kick-all').forEach(renderKickAllButton)
}

function disarmKickAll() {
    kickAllArmedConf = ''
    clearTimeout(kickAllArmTimer)
    document.querySelectorAll('.lazy-kick-all').forEach(renderKickAllButton)
}

function renderKickAllButton(btn) {
    const armed = kickAllArmedConf === btn.dataset.conf
    btn.classList.toggle('armed', armed)
    btn.textContent = armed
        ? `Точно викинути всіх (${btn.dataset.count})? Натисни ще раз`
        : `ВИКИНУТИ ВСІХ (${btn.dataset.count})`
}

// Набирає абонента і після відповіді заводить у конференцію — так само, ніби він сам
// набрав номер конференції. Local/…@from-internal іде через діалплан FreePBX, тож
// працює і для внутрішніх номерів, і для зовнішніх через вихідні маршрути.
async function dialIntoConf(confNumber, number) {
    setConfStatus(`Дзвоню ${number} → ${confNumber}. З'явиться у списку, щойно візьме трубку (↻ або повтор)`)
    sendQuery('channel originate', `Local/${number}@${DIAL_CONTEXT}`, `extension ${confNumber}@${DIAL_CONTEXT}`)
    await delay(ORIGINATE_SETTLE_MS)
    loadOneConf(confNumber)
}

// Номер для набору: канал зводимо до піра, пробіли/дужки/дефіси прибираємо
// (067-123-45-67 → 0671234567). Повертає '' для всього, що не схоже на номер, — щоб
// у CLI не потрапили зайві аргументи.
function normalizeDialNumber(value) {
    const number = extractPeerName(value).replace(/[\s()-]/g, '')
    return /^\+?[0-9*#]{2,20}$/.test(number) ? number : ''
}

function setConfStatus(text) {
    const status = document.querySelector('.confStatus')
    if (status) status.textContent = text
}

// Те саме для hangup: після нього перечитуємо список дзвінків.
async function hangupChannel(channel) {
    await sendAndWait('channel request hangup', channel)
    await delay(SETTLE_MS)
    showCallsDetailed()
}

function showAor(sipNumber) {
    sendQuery('pjsip show aor', sipNumber)
}

function showEndpoint(sipNumber) {
    sendQuery('pjsip show endpoint', sipNumber)
}

// Хвіст, яким закінчується повне ім'я контакту: 200/sips:200@192.168.0.50:50001;transport=TLS
const CONTACT_TRANSPORT_SUFFIX = ';transport=TLS'

// pjsip show contacts друкує "aor/uri" у колонці фіксованої ширини, тож хвіст
// ";transport=TLS" обрізається в довільному місці (";transpo", ";t", ";" або
// взагалі одразу після порту) — залежно від довжини номера/IP/порту.
// Дописуємо його назад, інакше pjsip show contact не знайде контакт.
function completeContactName(truncated) {
    const lower = truncated.toLowerCase()
    const suffix = CONTACT_TRANSPORT_SUFFIX.toLowerCase()
    if (lower.includes(suffix)) return truncated
    // Шукаємо найдовший початок суфікса, яким закінчується рядок (";transpo" → k=8).
    for (let k = suffix.length - 1; k >= 1; k--) {
        if (lower.endsWith(suffix.slice(0, k))) {
            return truncated.slice(0, truncated.length - k) + CONTACT_TRANSPORT_SUFFIX
        }
    }
    // Обрізано рівно по порту — дописуємо суфікс цілком.
    return truncated + CONTACT_TRANSPORT_SUFFIX
}

// pjsip show contact вимагає ПОВНЕ ім'я контакту, а не номер. Тому спочатку
// pjsip show contacts, дістаємо з виводу рядок "Contact:  200/sips:..." для цього
// номера, дописуємо обрізаний transport і вже тоді надсилаємо pjsip show contact.
async function showContact(sipNumber) {
    // sendAndWait очищає вивід сам, тому контакт зі старого виводу не потрапить у пошук.
    const text = await sendAndWait('pjsip show contacts')
    if (text === null) return

    const names = [...text.matchAll(/Contact:\s+(\S+)/g)]
        .map(m => m[1])
        .filter(name => name.startsWith(`${sipNumber}/`))

    if (names.length === 0) {
        setPeerStatus(`Контакт для ${sipNumber} не знайдено — номер не зареєстрований?`)
        return
    }
    if (names.length > 1) {
        setPeerStatus(`У ${sipNumber} контактів: ${names.length}, показую перший`)
    }
    sendQuery('pjsip show contact', completeContactName(names[0]))
}

function setPeerStatus(text) {
    const status = document.querySelector('.peerStatus')
    if (status) status.textContent = text
}

// pjsip show aor/endpoint/contact приймають ІМ'Я ПІРА (200), а не канал (SIP/200-000000a3).
// Користувач найчастіше копіює саме канал з виводу — приводимо до імені піра.
// Суфікс -xxxx ріжемо ТІЛЬКИ коли є префікс SIP/ — інакше пір з дефісом у імені
// (набраний вручну) залишиться неушкодженим.
function extractPeerName(value) {
    let v = value.trim()
    if (/^(PJ)?SIP\//i.test(v)) {
        v = v.replace(/^(PJ)?SIP\//i, '').replace(/-[^-]*$/, '')
    } else if (/^Local\//i.test(v)) {
        // Local/200@from-internal-00000002;1 → 200
        v = v.replace(/^Local\//i, '').replace(/@.*$/, '')
    }
    return v
}

function showCalls() {
    sendQuery('core show channels')
}

// hangup-кнопки вставляє decorateOutput: і тут, і на кожному оновленні в режимі повтору.
function showCallsDetailed() {
    sendQuery('core show channels verbose')
}


// --- Кнопки у виводі (kick / hangup) ---
// Вставляються з observer-а за останньою надісланою командою, а не з таймера
// після кліку. Тому вони з'являються одразу з відповіддю і переживають кожне
// оновлення в режимі повтору (live-моніторинг конференції чи дзвінків).

// Вставляє кнопку перед ПЕРШИМ каналом у кожному рядку. Повертає кількість кнопок.
// Викликати лише після unwrapHighlights, інакше regex захопить теги <mark> і
// data-sip буде поламаний.
function injectChannelButtons(pre, className, label, onClick) {
    // Регулярка нижче йде по HTML: data-value клікабельних токенів вона теж зачепила б.
    unwrapTokens(pre)
    const lines = pre.innerHTML.split('\n')
    let count = 0
    const newLines = lines.map(line => line.replace(CHANNEL_REGEX, (match) => {
        count++
        return `<button class="${className} lazy-decor" data-sip="${match}" style="margin-right: 5px; cursor: pointer;">${label}</button>${match}`
    }))
    if (count === 0) return 0

    pre.innerHTML = newLines.join('\n')
    pre.querySelectorAll(`.${className}`).forEach(btn => {
        btn.addEventListener('click', (e) => onClick(e.target.dataset.sip))
    })
    return count
}

function decorateOutput(pre) {
    // Кнопки вже стоять: це наша ж мутація або підсвітка. Вивід не змінився.
    if (pre.querySelector('.lazy-decor')) return

    const conf = lastSentCommand.match(/^confbridge list (\S+)$/)
    if (conf) {
        const confNumber = conf[1]
        // Один учасник = один рядок з каналом = одна kick-кнопка.
        const count = injectChannelButtons(pre, 'generated-kick-btn', 'kick', ch => kickOne(confNumber, ch))
        if (count === 0) return

        pre.style.maxWidth = '90vw'

        const summary = document.createElement('div')
        summary.className = 'lazy-decor lazy-conf-summary'
        summary.textContent = `Зараз у конференції ${confNumber}: ${count} ${pluralUk(count, 'учасник', 'учасники', 'учасників')}`
        pre.prepend(summary)
        updateConfOption(confNumber, count)

        const kickAllBTN = document.createElement('button')
        kickAllBTN.className = 'lazy-decor lazy-kick-all'
        kickAllBTN.dataset.conf = confNumber
        kickAllBTN.dataset.count = count
        renderKickAllButton(kickAllBTN)
        kickAllBTN.addEventListener('click', () => onKickAllClick(confNumber))
        pre.appendChild(kickAllBTN)
        return
    }

    if (lastSentCommand === 'core show channels verbose') {
        injectChannelButtons(pre, 'generated-hangup-btn', 'hangup', hangupChannel)
    }
}


// --- Клікабельні канали й номери у виводі ---
// Кожен канал (PJSIP/200-…) і номер (200) загортаємо в <span.lazy-token>. Клік відкриває
// меню: підставити в поле «Номер» або «Підсвітити». Без padding, як і <mark>, щоб не
// зсувати колонки.

// Ідемпотентна: обходить лише текст поза токенами, нашими кнопками й підсумком.
// Викликати ПІСЛЯ decorateOutput (той читає innerHTML) і ДО highlightMatches.
function linkifyOutput(pre) {
    const textNodes = []
    const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT)
    let n
    while ((n = walker.nextNode())) {
        if (!n.parentElement.closest('.lazy-token, .lazy-decor')) textNodes.push(n)
    }

    for (const textNode of textNodes) {
        const text = textNode.nodeValue
        const matches = [...text.matchAll(TOKEN_REGEX)]
        if (matches.length === 0) continue

        const fragment = document.createDocumentFragment()
        let lastIdx = 0
        for (const m of matches) {
            if (m.index > lastIdx) fragment.appendChild(document.createTextNode(text.slice(lastIdx, m.index)))
            const token = document.createElement('span')
            token.className = 'lazy-token'
            token.dataset.value = m[0]
            token.textContent = m[0]
            fragment.appendChild(token)
            lastIdx = m.index + m[0].length
        }
        if (lastIdx < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIdx)))
        textNode.parentNode.replaceChild(fragment, textNode)
    }
}

function unwrapTokens(root) {
    const tokens = root.querySelectorAll('.lazy-token')
    tokens.forEach(token => token.replaceWith(...token.childNodes))
    if (tokens.length > 0) root.normalize()
}

function closeTokenMenu() {
    const menu = document.querySelector('.lazyTokenMenu')
    if (menu) menu.remove()
}

function openTokenMenu(token) {
    closeTokenMenu()
    const value = token.dataset.value
    const peer = extractPeerName(value)

    const menu = document.createElement('div')
    menu.className = 'lazyTokenMenu'
    menu.innerHTML = `
        <div class="lazyTokenMenu-title"></div>
        <button data-action="peer"></button>
        <button data-action="highlight">Підсвітити</button>`
    menu.querySelector('.lazyTokenMenu-title').textContent = value
    menu.querySelector('[data-action="peer"]').textContent = `У поле «Номер»: ${peer}`

    menu.addEventListener('click', (e) => {
        const action = e.target.dataset.action
        if (!action) return
        if (action === 'peer') {
            const peerInput = document.getElementById('peerInput')
            peerInput.value = peer
            setPeerStatus('')
            peerInput.focus() // Enter одразу покаже endpoint
            flash(peerInput)
        } else {
            highlightInput.value = value
            refreshOutput()
            flash(highlightInput)
        }
        closeTokenMenu()
    })

    document.body.appendChild(menu)
    const rect = token.getBoundingClientRect()
    const maxLeft = window.scrollX + document.documentElement.clientWidth - menu.offsetWidth - 8
    menu.style.left = `${Math.max(window.scrollX, Math.min(rect.left + window.scrollX, maxLeft))}px`
    menu.style.top = `${rect.bottom + window.scrollY + 4}px`
}

// Коротко блимає полем, щоб було видно, куди підставилось значення.
function flash(el) {
    el.classList.remove('lazy-flash')
    void el.offsetWidth // reflow, інакше повторна анімація не стартує
    el.classList.add('lazy-flash')
}

// Один делегований обробник на document: токени живуть у pre[2], який FreePBX
// постійно замінює, тож вішати слухачі на самі span-и марно.
function onDocumentClick(e) {
    const token = e.target.closest('.lazy-token')
    if (token) {
        // Користувач виділяв текст мишею (щоб скопіювати) — меню не заважає.
        if (String(window.getSelection())) return
        openTokenMenu(token)
        return
    }
    if (!e.target.closest('.lazyTokenMenu')) closeTokenMenu()
}





// --- Highlight helpers ---
// Підсвічує входження тексту з #highlightInput у pre[2] обгортанням <mark>.
// Викликається на input у полі та з MutationObserver — щоб переживати
// перерендери (відповідь FreePBX, повтор кожні 5с, інжект kick/hangup кнопок).

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Розгортає всі <mark.lazy-highlight> назад у текст. ВАЖЛИВО: викликати ПЕРЕД
// будь-яким читанням pre[2].innerHTML у loadOneConf / showCallsDetailed —
// інакше regex /(SIP\/[^\s]+)/ захопить разом з тегами <mark> і поламає data-sip.
function unwrapHighlights(root) {
    if (!root) return
    const marks = root.querySelectorAll('mark.lazy-highlight')
    marks.forEach(mark => {
        const parent = mark.parentNode
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
        parent.removeChild(mark)
    })
    if (marks.length > 0) root.normalize()
}

// Єдина точка обробки виводу: на кожну зміну DOM (observer) і на введення в поле підсвітки.
// Порядок важливий: зняти підсвітку → вставити kick/hangup (читає innerHTML) →
// загорнути канали/номери в клікабельні токени → підсвітити знову.
function refreshOutput() {
    const pre = document.querySelectorAll('pre')[2]
    if (!pre) return

    // Відключаємо observer на час власної мутації — інакше нескінченний цикл.
    if (outputObserver) outputObserver.disconnect()

    try {
        unwrapHighlights(pre)
        decorateOutput(pre)
        linkifyOutput(pre)
        highlightMatches(pre)
    } finally {
        // Спостерігаємо за document.body, а НЕ за pre[2]: FreePBX при відправці нової
        // команди замінює сам елемент <pre> новим node-ом, тож підписка на конкретний
        // pre помирає після першого ж перерендеру. body завжди в DOM і ніколи не зникає.
        if (outputObserver) {
            outputObserver.observe(document.body, { childList: true, characterData: true, subtree: true })
        }
    }
}

function highlightMatches(pre) {
    const query = highlightInput ? highlightInput.value : ''
    if (!query) return

    const regex = new RegExp(escapeRegex(query), 'gi')
    const textNodes = []
    const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT)
    let n
    while ((n = walker.nextNode())) textNodes.push(n)

    for (const textNode of textNodes) {
        const text = textNode.nodeValue
        regex.lastIndex = 0
        if (!regex.test(text)) continue

        regex.lastIndex = 0
        const fragment = document.createDocumentFragment()
        let lastIdx = 0
        let m
        while ((m = regex.exec(text)) !== null) {
            if (m.index > lastIdx) {
                fragment.appendChild(document.createTextNode(text.slice(lastIdx, m.index)))
            }
            const mark = document.createElement('mark')
            mark.className = 'lazy-highlight'
            mark.textContent = m[0]
            fragment.appendChild(mark)
            lastIdx = m.index + m[0].length
            if (m[0].length === 0) regex.lastIndex++ // safeguard від zero-width
        }
        if (lastIdx < text.length) {
            fragment.appendChild(document.createTextNode(text.slice(lastIdx)))
        }
        textNode.parentNode.replaceChild(fragment, textNode)
    }
}

// Прогресбар відліку до наступного автоматичного надсилання.
// Викликається на старті повтору і на кожному tick-у setInterval.
// Тривалість анімації = repeatSeconds (синхронно з фактичним інтервалом).
//
// КРИТИЧНО: між двома присвоєннями `width` потрібен `void offsetWidth` —
// інакше браузер злиє обидві мутації стилю в одну (фінальну) і transition
// не запуститься. Без цього reflow бар просто стрибне в 100% без анімації.
function kickRepeatProgress() {
    if (!repeatProgressFill) return
    repeatProgressFill.style.transition = 'none'
    repeatProgressFill.style.width = '0%'
    void repeatProgressFill.offsetWidth // форсуємо reflow
    repeatProgressFill.style.transition = `width ${repeatSeconds}s linear`
    repeatProgressFill.style.width = '100%'
}

// Українська множина: форма для 1 / 2-4 / 5+ (з винятками 11-14).
function pluralUk(n, one, few, many) {
    const mod10 = n % 10
    const mod100 = n % 100
    if (mod10 === 1 && mod100 !== 11) return one
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
    return many
}

// 1 секунду / 2-4 секунди / 5+ секунд.
function pluralizeSeconds(n) {
    return pluralUk(n, 'секунду', 'секунди', 'секунд')
}

// Єдине джерело правди для напису на кнопці повтору.
function updateRepeatLabel() {
    if (!repeatButton) return
    repeatButton.innerText = isOnRepeat
        ? 'Перестати повторювати'
        : `Відправляти раз в ${repeatSeconds} ${pluralizeSeconds(repeatSeconds)}`
}

// (Пере)запускає інтервал повтору з поточним repeatSeconds і синхронізує прогресбар.
function startRepeater() {
    clearInterval(repeater)
    repeater = setInterval(() => {
        if (!isDestructiveCommand(inputCLI.value)) buttonCLI.click()
        kickRepeatProgress()
    }, repeatSeconds * 1000)
    kickRepeatProgress()
}

// Коригує інтервал на delta секунд (мінімум 1с). Якщо повтор активний — миттєво перезапускає його.
function adjustRepeat(delta) {
    repeatSeconds = Math.max(1, repeatSeconds + delta)
    updateRepeatLabel()
    if (isOnRepeat) startRepeater()
}

//shoots at the start
function initExtension() {

    let newDiv = document.createElement("div");

    newDiv.innerHTML = `
        <div id="lazyAsterisk">
            <div class="controlButtons">
                <button class="loadConfs">
                    Завантажити конференції
                </button>

                <button class="showCalls">
                    Показати дзвінки
                </button>

		<button class="showCallsDetailed">
                    Показати дзвінки (детальніше)
                </button>

                <button class="repeatMinus" title="Зменшити інтервал на 1 секунду">−</button>

                <button class="repeatPlus" title="Збільшити інтервал на 1 секунду">+</button>

                <button class="onRepeat">
                    Відправляти раз в 5 секунд
                </button>
            </div>
            <div class="peerRow">
                <label for="peerInput">Номер:</label>
                <input id="peerInput" type="text" placeholder="напр., 200 або SIP/200-000000a3 — канал зведемо до піра самі">
                <button class="peerAor" title="pjsip show aor — AOR номера та його контакти">AOR</button>
                <button class="peerEndpoint" title="pjsip show endpoint — налаштування, кодеки, статус (також по Enter)">Endpoint</button>
                <button class="peerContact" title="pjsip show contacts → знаходить повне ім'я контакту → pjsip show contact">Contact</button>
                <span class="peerStatus"></span>
            </div>
            <div class="highlightRow">
                <label for="highlightInput">Підсвітити в виводі:</label>
                <input id="highlightInput" type="text" placeholder="напр., 200 або SIP/200 — стійко до повтору кожні 5с">
                <button class="clearHighlight" title="Очистити підсвітку">×</button>
            </div>
            <div class="ext-output">

            </div>

            <div class="repeatProgress">
                <div class="repeatProgress-fill"></div>
            </div>


        </div>`
    document.querySelectorAll('.container-fluid')[1].prepend(newDiv)
    outputDiv = document.querySelector('.ext-output')
    document.querySelector('.loadConfs').addEventListener('click', () =>
        loadAllConfs()
    )

    //show calls button

    document.querySelector('.showCalls').addEventListener('click', showCalls)
    document.querySelector('.showCallsDetailed').addEventListener('click', showCallsDetailed)

    // --- Рядок роботи з одним піром (pjsip show aor / endpoint / contact) ---
    const peerInput = document.getElementById('peerInput')
    const runPeerAction = (fn) => {
        const peer = extractPeerName(peerInput.value)
        if (!peer) return
        setPeerStatus('')
        fn(peer)
    }
    document.querySelector('.peerAor').addEventListener('click', () => runPeerAction(showAor))
    document.querySelector('.peerEndpoint').addEventListener('click', () => runPeerAction(showEndpoint))
    document.querySelector('.peerContact').addEventListener('click', () => runPeerAction(showContact))
    // Enter у полі = найінформативніша дія — endpoint.
    peerInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') runPeerAction(showEndpoint)
    })










    //repeat every 5 seconds listener

    repeatButton = document.querySelector('.onRepeat')
    repeatProgress = document.querySelector('.repeatProgress')
    repeatProgressFill = document.querySelector('.repeatProgress-fill')

    repeatButton.addEventListener('click', () => {
        if (isOnRepeat === false) {
            isOnRepeat = true
            repeatProgress.classList.add('active')
            startRepeater()
            repeatButton.classList.add('test')
        } else {
            isOnRepeat = false
            clearInterval(repeater)
            repeatProgress.classList.remove('active')
            repeatProgressFill.style.transition = 'none'
            repeatProgressFill.style.width = '0%'
            repeatButton.classList.remove('test')
        }
        updateRepeatLabel()
    })

    document.querySelector('.repeatMinus').addEventListener('click', () => adjustRepeat(-1))
    document.querySelector('.repeatPlus').addEventListener('click', () => adjustRepeat(1))

    updateRepeatLabel()

    // --- Підсвітка тексту в pre[2] ---
    highlightInput = document.getElementById('highlightInput')
    highlightInput.addEventListener('input', refreshOutput)

    document.querySelector('.clearHighlight').addEventListener('click', () => {
        highlightInput.value = ''
        refreshOutput()
    })

    // --- Меню клікабельних каналів/номерів у виводі ---
    document.addEventListener('click', onDocumentClick)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeTokenMenu()
    })

    // Запам'ятовуємо КОЖНУ надіслану команду: нашу, ручну чи з повтору.
    // Capture-фаза: встигаємо прочитати #astcmd до обробника FreePBX, навіть якщо
    // той очищає поле. Enter у полі CLI теж ловимо окремо.
    const rememberSent = () => { lastSentCommand = normalizeCommand(inputCLI.value) }
    buttonCLI.addEventListener('click', rememberSent, true)
    inputCLI.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') rememberSent()
    })

    // Спостерігаємо за document.body: на кожну зміну DOM (відповідь FreePBX після
    // будь-якої відправленої команди чи інтервалу повтору) вставляємо kick/hangup
    // кнопки й відновлюємо підсвітку. Слухаємо body, бо FreePBX замінює сам <pre>
    // цілком, і підписка на конкретний node жила б лише до першого перерендеру.
    // attributes НЕ слухаємо → style-зміни прогресбару не тригерять зайвих проходів.
    if (typeof MutationObserver !== 'undefined') {
        outputObserver = new MutationObserver(() => refreshOutput())
        outputObserver.observe(document.body, { childList: true, characterData: true, subtree: true })
    }

}

// Рядки таблиці `confbridge list`: ім'я, Users, Marked, Locked, [Muted].
// Шапка, роздільник "====" і будь-який інший текст під шаблон не підпадають:
// там немає двох чисел поспіль у 2-й і 3-й колонках.
const CONF_ROW_REGEX = /^[ \t]*(\S+)[ \t]+(\d+)[ \t]+(\d+)[ \t]+(\S+)/gm

function confOptionText(name, users, locked) {
    return `${name} — ${users} ${pluralUk(users, 'учасник', 'учасники', 'учасників')}${locked ? ' 🔒' : ''}`
}

// Перегляд конференції знає точну кількість учасників — оновлюємо й пункт dropdown,
// щоб він не показував число з моменту завантаження списку.
function updateConfOption(confNumber, count) {
    const option = [...document.querySelectorAll('.ext-output select option')].find(o => o.value === confNumber)
    if (option) option.text = confOptionText(confNumber, count, option.dataset.locked === '1')
}

function parseConfList(text) {
    return [...text.matchAll(CONF_ROW_REGEX)].map(m => ({
        name: m[1],
        users: Number(m[2]),
        locked: /^(yes|locked)$/i.test(m[4]),
    }))
}

// Список конференцій → dropdown (або попередження, якщо їх немає).
async function loadAllConfs() {
    const text = await sendAndWait('confbridge list')
    if (text === null) return

    const confs = parseConfList(text)

    // Недонабраний номер переживає перебудову панелі.
    const dialDraft = outputDiv.querySelector('#dialInput')?.value ?? ''

    // Чистимо ЗАВЖДИ, до розгалуження — інакше повторні натискання
    // «Завантажити конференції» без активних конференцій апендять
    // попередження одне за одним.
    outputDiv.innerHTML = ''

    if (confs.length === 0) {
        selectedConf = ''
        const warningIfEmpty = document.createElement('p')
        warningIfEmpty.innerText = 'Зараз немає конференцій :('
        outputDiv.append(warningIfEmpty)
        return
    }

    const select = document.createElement('select')

    // value='' — щоб повернення на плейсхолдер не надсилало «confbridge list Оберіть конференцію».
    const placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.text = 'Оберіть конференцію'
    select.append(placeholder)

    for (const conf of confs) {
        const option = document.createElement('option')
        option.value = conf.name
        option.text = confOptionText(conf.name, conf.users, conf.locked)
        if (conf.locked) option.dataset.locked = '1'
        select.appendChild(option)
    }
    // Оновлення списку не скидає вибрану конференцію, якщо вона ще існує.
    if (confs.some(c => c.name === selectedConf)) select.value = selectedConf
    outputDiv.appendChild(select)

    select.addEventListener('change', () => {
        if (select.value) loadOneConf(select.value)
    })

    // Повторний вибір тієї ж конференції не викликає change, тому оновлення робимо окремою кнопкою.
    const refresh = document.createElement('button')
    refresh.className = 'refreshConf'
    refresh.title = 'Перечитати вибрану конференцію (або список, якщо нічого не вибрано)'
    refresh.innerText = '↻ Оновити'
    refresh.addEventListener('click', () => {
        if (select.value) loadOneConf(select.value)
        else loadAllConfs()
    })
    outputDiv.appendChild(refresh)

    // --- Набрати абонента у вибрану конференцію ---
    const dialInput = document.createElement('input')
    dialInput.id = 'dialInput'
    dialInput.type = 'text'
    dialInput.placeholder = 'номер, напр. 210'
    dialInput.value = dialDraft
    const dialButton = document.createElement('button')
    dialButton.className = 'dialToConf'
    dialButton.title = `channel originate Local/<номер>@${DIAL_CONTEXT} extension <конференція>@${DIAL_CONTEXT} — телефон задзвонить, після відповіді абонент потрапить у конференцію`
    dialButton.textContent = '📞 Набрати в конференцію'
    const status = document.createElement('span')
    status.className = 'confStatus'

    const dial = () => {
        if (!select.value) return setConfStatus('Спершу оберіть конференцію')
        const number = normalizeDialNumber(dialInput.value)
        if (!number) return setConfStatus('Номер — лише цифри (можна з +, *, #)')
        dialIntoConf(select.value, number)
    }
    dialButton.addEventListener('click', dial)
    dialInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') dial()
    })
    outputDiv.append(dialInput, dialButton, status)
}

// Учасники однієї конференції. Кнопки kick / ВИКИНУТИ ВСІХ вставляє decorateOutput.
async function loadOneConf(confNumber) {
    selectedConf = confNumber
    const text = await sendAndWait('confbridge list ', confNumber)
    if (text === null) return

    // Конференція завершилась (викинули останнього або всі вийшли), тож dropdown застарів.
    if (/No conference bridge named/i.test(text)) {
        selectedConf = ''
        loadAllConfs()
    }
}


initExtension()
