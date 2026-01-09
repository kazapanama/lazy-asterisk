
const inputCLI = document.getElementById('astcmd')
const buttonCLI = document.querySelector('#send')

let outputDiv
let tmp

let isOnRepeat = false
let repeater
let repeatButton




//kick all
function kickAll(confNumber) {
    sendQuery('confbridge kick ', confNumber,' all')
}

//kick one extension
function kickOne( confNumber, sipNumber,) {
    sendQuery('confbridge kick ', confNumber, sipNumber)
    setTimeout(()=>loadOneConf(confNumber),1000)
}

function showPeerInfo(sipNumber) {
    sendQuery('sip show peer', sipNumber)
}

function unregisterPeer(sipNumber){
    sendQuery('sip unregister', sipNumber)
}

function showCalls(){
    sendQuery('core show channels')
}

function showCallsDetailed(){
    sendQuery('core show channels verbose')
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
            <div class="ext-output">

            </div>


        </div>`
    document.querySelectorAll('.container-fluid')[1].prepend(newDiv)
    outputDiv = document.querySelector('.ext-output')
    document.querySelector('.loadConfs').addEventListener('click',()=>
        loadAllConfs()
        )

	//show calls button

	document.querySelector('.showCalls').addEventListener('click',showCalls)
	document.querySelector('.showCallsDetailed').addEventListener('click',showCallsDetailed)










    //repeat every 5 seconds listener

    repeatButton = document.querySelector('.onRepeat')

    repeatButton.addEventListener('click',()=>{
        if (isOnRepeat === false){
            isOnRepeat = true
            repeater = setInterval(()=>buttonCLI.click(),5000)
            repeatButton.innerText = 'Перестати повторювати'
	    repeatButton.classList.add('test')
        } else {
            isOnRepeat = false
            clearInterval(repeater) 
            repeatButton.innerText = 'Відправляти раз в 5 секунд'
	    repeatButton.classList.remove('test')
        }

    })
        
}

// shoots when conf button pressed, 1 sec delay
function loadAllConfs() {
    sendQuery('confbridge list')
    setTimeout(()=>{
        let preElement = document.querySelectorAll('pre')[2].textContent

        const regex = /\d{3,}/g
        let matches = [...preElement.matchAll(regex)].map(item=>item[0])
    

        if ( matches.length > 0 ){
            let select = document.createElement("select");
            
            let placeholder = document.createElement("option");
            placeholder.text = 'Оберіть конференцію'

            select.append(placeholder)

            for (match of matches){
                let option = document.createElement("option");
                option.value = match
                option.text = match
                select.appendChild(option);
            }       
            outputDiv.innerHTML = ''
            outputDiv.appendChild(select)
        
            select.addEventListener('change', ()=>loadOneConf(select.value))
        } else {
            //nema conferenciy

            let warningIfEmpty = document.createElement("p");
            warningIfEmpty.innerText = 'Заз немає конференцій :('
            outputDiv.append(warningIfEmpty)
        }

    },1000)
    }
    
// shoots when exact conf is selected, 1 sec delay
function loadOneConf(confNumber) {
    sendQuery('confbridge list ', confNumber)

    setTimeout(()=>{

        let preElement = document.querySelectorAll('pre')[2]
        
        preElement.querySelectorAll('button').forEach(btn=>btn.remove())

        preElement.style.maxWidth = '90vw'
        

        
        const regex = /SIP\/[^\s]+/g
       
        let matches = [...preElement.textContent.matchAll(regex)]
        
        
        // matches = [[...new Set(...matches)]]
        console.log(matches)
        for (match of matches){
            preElement.innerHTML += `<button data-id="${match}">kick ${match}</button>`
        }
        let buttons = document.querySelectorAll('[data-id]')
        
        buttons.forEach((button)=> {
                console.log(button)
                button.addEventListener('click', ()=>{
                    kickOne( confNumber, button.dataset.id),
                    preElement.querySelectorAll('button').forEach(btn=>btn.remove())
                      }
                    )
        }  
        )



                //kick all btn 
                let kickAllBTN = document.createElement('button')
                kickAllBTN.innerText = 'ВИКИНУТИ ВСІХ'
                kickAllBTN.style.color = 'red'
                
                kickAllBTN.addEventListener('click',()=>{
                    kickAll(confNumber)
                })
                preElement.append(kickAllBTN)



    },1000)

    
}


initExtension()
