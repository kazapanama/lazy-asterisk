function sendQuery(command, number = ' ', optional = ' ') {
    inputCLI.value = `${command}  ${number}  ${optional}`
    console.log(inputCLI.value)
    buttonCLI.click()
}