
const inputCLI = document.getElementById('astcmd')
const buttonCLI = document.querySelector('#send')

let outputDiv
let tmp

let isOnRepeat = false
let repeater
let repeatButton

let highlightInput
let highlightObserver




//kick all
function kickAll(confNumber) {
    sendQuery('confbridge kick ', confNumber, ' all')
}

//kick one extension
function kickOne(confNumber, sipNumber,) {
    sendQuery('confbridge kick ', confNumber, sipNumber)
    setTimeout(() => loadOneConf(confNumber), 2000)
}

function showPeerInfo(sipNumber) {
    sendQuery('sip show peer', sipNumber)
}

function unregisterPeer(sipNumber) {
    sendQuery('sip unregister', sipNumber)
}

function showCalls() {
    sendQuery('core show channels')
}

function showCallsDetailed() {
    sendQuery('core show channels verbose')

    setTimeout(() => {
        let preElement = document.querySelectorAll('pre')[2]

        // Зняти підсвітку ПЕРЕД читанням innerHTML, інакше regex захопить теги <mark>
        // і data-sip у hangup-кнопці буде поламаний. Observer верне підсвітку після нашого запису.
        unwrapHighlights(preElement)

        // regex to find SIP/xxxxx...
        const regex = /(SIP\/[^\s]+)/

        let lines = preElement.innerHTML.split('\n')

        let newLines = lines.map(line => {
            return line.replace(regex, (match) => {
                return `<button class="generated-hangup-btn" data-sip="${match}" style="margin-right: 5px; cursor: pointer;">hangup</button>${match}`
            })
        })

        preElement.innerHTML = newLines.join('\n')

        // Add event listeners to the new buttons
        preElement.querySelectorAll('.generated-hangup-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sipId = e.target.dataset.sip
                sendQuery('channel request hangup', sipId)
            })
        })

    }, 1000)
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

function applyHighlight() {
    const pre = document.querySelectorAll('pre')[2]
    if (!pre || !highlightInput) return

    // Відключаємо observer на час власної мутації — інакше нескінченний цикл.
    if (highlightObserver) highlightObserver.disconnect()

    try {
        unwrapHighlights(pre)
        const query = highlightInput.value
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
    } finally {
        if (highlightObserver && pre) {
            highlightObserver.observe(pre, { childList: true, characterData: true, subtree: true })
        }
    }
}

//shoots at the start
function initExtension() {

    let newDiv = document.createElement("div");

    newDiv.innerHTML = `
        <div id="lazyAsterisk">
            <div class="controlButtons">
                <button class="loadExtensions">
                    1 номер
                </button>
                
                <button class="loadConfs">
                    Завантажити конференції
                </button>

                <button class="showCalls">
                    Показати дзвінки
                </button>

		<button class="showCallsDetailed">
                    Показати дзвінки (детальніше)
                </button>

                <button class="onRepeat">
                    Відправляти раз в 5 секунд
                </button>
            </div>
            <div class="highlightRow">
                <label for="highlightInput">Підсвітити в виводі:</label>
                <input id="highlightInput" type="text" placeholder="напр., 200 або SIP/200 — стійко до повтору кожні 5с">
                <button class="clearHighlight" title="Очистити підсвітку">×</button>
            </div>
            <div class="ext-output">

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










    //repeat every 5 seconds listener

    repeatButton = document.querySelector('.onRepeat')

    repeatButton.addEventListener('click', () => {
        if (isOnRepeat === false) {
            isOnRepeat = true
            repeater = setInterval(() => buttonCLI.click(), 5000)
            repeatButton.innerText = 'Перестати повторювати'
            repeatButton.classList.add('test')
        } else {
            isOnRepeat = false
            clearInterval(repeater)
            repeatButton.innerText = 'Відправляти раз в 5 секунд'
            repeatButton.classList.remove('test')
        }

    })

    // --- Підсвітка тексту в pre[2] ---
    highlightInput = document.getElementById('highlightInput')
    highlightInput.addEventListener('input', applyHighlight)

    document.querySelector('.clearHighlight').addEventListener('click', () => {
        highlightInput.value = ''
        applyHighlight()
    })

    // Спостерігаємо за pre[2]: на кожну зміну (відповідь FreePBX, інтервал
    // кожні 5с, інжект kick/hangup кнопок) переалоковуємо підсвітку.
    const pre2 = document.querySelectorAll('pre')[2]
    if (pre2 && typeof MutationObserver !== 'undefined') {
        highlightObserver = new MutationObserver(() => applyHighlight())
        highlightObserver.observe(pre2, { childList: true, characterData: true, subtree: true })
    }

}

// shoots when conf button pressed, 1 sec delay
function loadAllConfs() {
    sendQuery('confbridge list')
    setTimeout(() => {
        let preElement = document.querySelectorAll('pre')[2].textContent

        const regex = /\d{3,}/g
        let matches = [...preElement.matchAll(regex)].map(item => item[0])


        if (matches.length > 0) {
            let select = document.createElement("select");

            let placeholder = document.createElement("option");
            placeholder.text = 'Оберіть конференцію'

            select.append(placeholder)

            for (match of matches) {
                let option = document.createElement("option");
                option.value = match
                option.text = match
                select.appendChild(option);
            }
            outputDiv.innerHTML = ''
            outputDiv.appendChild(select)

            select.addEventListener('change', () => loadOneConf(select.value))
        } else {
            //nema conferenciy

            let warningIfEmpty = document.createElement("p");
            warningIfEmpty.innerText = 'Заз немає конференцій :('
            outputDiv.append(warningIfEmpty)
        }

    }, 1000)
}

// shoots when exact conf is selected, 1 sec delay
function loadOneConf(confNumber) {
    // Clear the output buffer to avoid duplicates
    document.querySelectorAll('pre')[2].innerHTML = ''

    sendQuery('confbridge list ', confNumber)

    setTimeout(() => {

        let preElement = document.querySelectorAll('pre')[2]

        // Зняти підсвітку ПЕРЕД читанням innerHTML — див. коментар у showCallsDetailed.
        unwrapHighlights(preElement)

        // Remove existing buttons (including old kick buttons and kick-all)
        preElement.querySelectorAll('button').forEach(btn => btn.remove())

        preElement.style.maxWidth = '90vw'

        // regex to find SIP/xxxxx...
        const regex = /(SIP\/[^\s]+)/

        let lines = preElement.innerHTML.split('\n')

        let newLines = lines.map(line => {
            return line.replace(regex, (match) => {
                return `<button class="generated-kick-btn" data-sip="${match}" style="margin-right: 5px; cursor: pointer;">kick</button>${match}`
            })
        })

        preElement.innerHTML = newLines.join('\n')

        // Add event listeners to the inline kick buttons
        preElement.querySelectorAll('.generated-kick-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sipId = e.target.dataset.sip
                kickOne(confNumber, sipId)
                // We keep the reloading logic that was inside kickOne, so no extra reload needed here
            })
        })

        // Re-add "Kick All" button at the bottom
        let kickAllBTN = document.createElement('button')
        kickAllBTN.innerText = 'ВИКИНУТИ ВСІХ'
        kickAllBTN.style.color = 'red'
        kickAllBTN.style.marginTop = '10px'
        kickAllBTN.style.display = 'block'

        kickAllBTN.addEventListener('click', () => {
            kickAll(confNumber)
        })
        preElement.appendChild(kickAllBTN)

    }, 1000)


}


initExtension()
