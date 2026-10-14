function sendQuery(command, number = ' ', optional = ' ') {
    inputCLI.value = `${command}  ${number}  ${optional}`
    console.log(inputCLI.value)
    buttonCLI.click()
}

// Скільки максимум чекати на відповідь Asterisk, перш ніж здатися.
const RESPONSE_TIMEOUT_MS = 5000

// Надсилає команду і чекає, поки FreePBX оновить pre[2]. Фіксованої паузи немає:
// Promise завершується одразу, щойно з'являється відповідь.
// Повертає текст відповіді або null, якщо:
//   • Asterisk не відповів за RESPONSE_TIMEOUT_MS;
//   • поки ми чекали, у CLI надіслали ІНШУ команду (тоді відповідь уже не наша).
//
// pre[2] очищаємо ПЕРЕД надсиланням. Так будь-який непорожній текст точно є новою
// відповіддю, навіть коли вона збігається зі старою і навіть коли FreePBX оновлює
// вміст на місці, а не замінює сам <pre>. Слухаємо document.body з тієї ж причини,
// що й підсвітка: FreePBX міняє <pre> на новий node.
// Використовує lastSentCommand з main.js (спільний script-scope).
function sendAndWait(command, number = ' ', optional = ' ') {
    document.querySelectorAll('pre')[2].textContent = ''

    return new Promise(resolve => {
        let myCommand
        let timer
        const observer = new MutationObserver(() => check())

        const finish = (result) => {
            observer.disconnect()
            clearTimeout(timer)
            resolve(result)
        }

        const check = () => {
            if (lastSentCommand !== myCommand) return finish(null)
            const pre = document.querySelectorAll('pre')[2]
            const text = pre ? pre.textContent : ''
            if (text.trim() !== '') finish(text)
        }

        observer.observe(document.body, { childList: true, characterData: true, subtree: true })
        timer = setTimeout(() => {
            console.warn(`Asterisk не відповів за ${RESPONSE_TIMEOUT_MS} мс: ${myCommand}`)
            finish(null)
        }, RESPONSE_TIMEOUT_MS)

        sendQuery(command, number, optional)
        myCommand = lastSentCommand
        // Відповідь могла прийти синхронно, ще всередині click (так робить мок у visual-tests).
        check()
    })
}
