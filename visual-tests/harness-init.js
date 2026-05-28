// Читає ?scenario=... з URL і автоматично запускає відповідний сценарій
// шляхом програмного кліку по реальних кнопках розширення. Радіокнопки моку
// при цьому теж виставляються у правильне положення.
(function () {
  const params = new URLSearchParams(window.location.search);
  const scenario = params.get('scenario');

  const tag = document.getElementById('scenarioTag');
  const banner = document.getElementById('scenarioBanner');

  const SCENARIOS = {
    'confs-multi':      { label: 'confs-multi — 2 активні конф',     conf: 'multi' },
    'confs-empty':      { label: 'confs-empty — 0 конф',             conf: 'none'  },
    'one-conf':         { label: 'one-conf — drill in 5500',         conf: 'multi' },
    'calls':            { label: 'calls — core show channels',       calls: 'multi'},
    'calls-detailed':   { label: 'calls-detailed + hangup btns',     calls: 'multi'},
    'repeat':           { label: 'repeat — toggle interval',                       },
    'highlight':        { label: 'highlight — підсвітка "200"',      calls: 'multi'},
    'highlight-repeat': { label: 'highlight + repeat (стійкість)',   calls: 'multi'},
  };

  if (!scenario || !SCENARIOS[scenario]) {
    tag.textContent = 'сценарій: початковий стан';
    return;
  }

  const cfg = SCENARIOS[scenario];
  tag.textContent = 'сценарій: ' + cfg.label;

  function setRadio(name, value) {
    if (!value) return;
    const el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (el) el.checked = true;
  }

  function showBanner(msg) {
    banner.textContent = msg;
    banner.classList.add('show');
  }

  // 50 мс fairly safe — main.js вже виконався, кнопки прив'язані.
  setTimeout(() => {
    setRadio('conf-scenario', cfg.conf);
    setRadio('calls-scenario', cfg.calls);

    if (scenario === 'confs-multi' || scenario === 'confs-empty') {
      showBanner('Автоматично натиснуто «Завантажити конференції». Чекай ≈1с до відображення dropdown/попередження.');
      document.querySelector('.loadConfs').click();

    } else if (scenario === 'one-conf') {
      showBanner('Завантажую перелік конф → через 1.1с обираю 5500 → ще через 1с з\'являться kick-кнопки.');
      document.querySelector('.loadConfs').click();
      // Розширення викликає loadAllConfs з setTimeout 1000 — чекаємо трохи більше, щоб dropdown зрендерився.
      setTimeout(() => {
        const select = document.querySelector('.ext-output select');
        if (select) {
          select.value = '5500';
          select.dispatchEvent(new Event('change'));
        }
      }, 1100);

    } else if (scenario === 'calls') {
      showBanner('Автоматично натиснуто «Показати дзвінки».');
      document.querySelector('.showCalls').click();

    } else if (scenario === 'calls-detailed') {
      showBanner('Автоматично натиснуто «Показати дзвінки (детальніше)». Через ≈1с з\'являться hangup-кнопки в pre[2].');
      document.querySelector('.showCallsDetailed').click();

    } else if (scenario === 'repeat') {
      // Закидаємо команду в CLI, щоб interval мав що повторно надсилати — інакше демо «німе».
      document.getElementById('astcmd').value = 'core show channels';
      showBanner('У CLI вписано "core show channels", натиснуто toggle. Лейбл змінено, додано клас .test, стартував setInterval(5000) — кожні 5с побачиш новий запис у лозі.');
      document.querySelector('.onRepeat').click();

    } else if (scenario === 'highlight') {
      // Вписуємо "200" у поле підсвітки і відкриваємо детальний список дзвінків.
      document.getElementById('highlightInput').value = '200';
      document.getElementById('highlightInput').dispatchEvent(new Event('input'));
      showBanner('У полі «Підсвітити в виводі» — "200". Через ≈1с з\'являться hangup-кнопки, і всі входження "200" будуть підсвічені жовтим (включно з цифрами у hangup-кнопках та тривалостях).');
      document.querySelector('.showCallsDetailed').click();

    } else if (scenario === 'highlight-repeat') {
      // Найкорисніший сценарій: підсвітка + повтор 5с разом.
      document.getElementById('highlightInput').value = '200';
      document.getElementById('highlightInput').dispatchEvent(new Event('input'));
      document.getElementById('astcmd').value = 'core show channels verbose';
      showBanner('Підсвітка "200" увімкнена, у CLI — "core show channels verbose", репіт-режим увімкнено. Кожні 5с FreePBX-мок переписує pre[2] — підсвітка автоматично відновлюється (через MutationObserver). Ctrl+F такого не вміє.');
      // Спершу один прямий клік, щоб одразу побачити підсвітку.
      document.querySelector('.showCallsDetailed').click();
      // А потім вмикаємо інтервал — кожні 5с буде новий рендер pre[2] + переалоковка підсвітки.
      setTimeout(() => document.querySelector('.onRepeat').click(), 1100);
    }
  }, 50);
})();
