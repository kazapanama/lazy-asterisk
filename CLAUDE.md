# CLAUDE.md — guide for future Claude sessions

## What this project is

**"Астеріск для лінивих"** — a Chrome Manifest V3 **content script** that injects helper UI into the FreePBX Asterisk CLI page. It does not have a build step, no bundler, no TypeScript, no framework. Two plain `<script>` files are loaded into the page in a fixed order via `manifest.json`.

Target URL (`content_scripts[0].matches` in `manifest.json`): `*://*/admin/config.php?display=cli*` — the FreePBX CLI page on any host, http or https. No per-deployment edit needed.

## File map

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest. Loads `utils.js` then `main.js` as content scripts on the FreePBX CLI page. |
| `utils.js` | Defines `sendQuery(command, number, optional)` and `sendAndWait(...)` (see below). References `inputCLI` / `buttonCLI` / `lastSentCommand` (defined in `main.js`). |
| `main.js` | All UI and behavior. Auto-runs `initExtension()` at the bottom on load. |
| `style.css` | Button styling. |
| `img/tango.png` | Extension icon. |
| `tests/` | Vitest + jsdom test suite (dev-only — never shipped to Chrome). |

## Critical architecture quirk — script-scoped sharing

`utils.js` and `main.js` are **two separate `<script>` tags** but they share **script-scoped** `const`/`let` declarations (per the HTML spec, classic scripts in the same realm share a script-scope lexical environment).

- `main.js` declares `const inputCLI = document.getElementById('astcmd')` at top level.
- `utils.js`'s `sendQuery` reads `inputCLI` at call time — and it works because both scripts share scope.

**Do not** convert either file to `type="module"` or rewrite as ESM — that would break the cross-script reference.

## `sendQuery` whitespace contract

```js
inputCLI.value = `${command}  ${number}  ${optional}`
```

Two spaces between each part. `number` and `optional` default to `' '` (a single space). Be mindful when reading expected command strings: e.g. `kickAll('5500')` calls `sendQuery('confbridge kick ', '5500', ' all')`, which produces:

```
'confbridge kick   5500   all'   ← 3 spaces around 5500 (cmd has trailing space + 2 sep; ' all' has leading space + 2 sep)
```

## DOM assumptions

`main.js` queries the host page in several places. The FreePBX CLI page provides these — don't break the assumptions:

- `#astcmd` — the CLI input
- `#send` — the CLI submit button
- `.container-fluid` — there must be at least 2; the panel is prepended into the **second** one (`[1]`)
- `document.querySelectorAll('pre')[2]` — the third `<pre>` is the FreePBX command-output region. FreePBX answers by **swapping the whole `<pre>` node**, so every observer watches `document.body`, never a specific `pre`.

## Waiting for a response — `sendAndWait` (no fixed timers)

`sendAndWait(command, number, optional)` in `utils.js` returns a Promise that resolves **the moment** the answer lands in `pre[2]`, not after a fixed delay:

1. clears `pre[2]` (`textContent = ''`), so any non-empty text is guaranteed to be the new answer — even if identical to the old one, and whether FreePBX swaps the node or updates it in place;
2. sends via `sendQuery`, then a `MutationObserver` on `document.body` resolves with `pre[2].textContent` once it's non-empty;
3. resolves **`null`** after `RESPONSE_TIMEOUT_MS` (5000), or as soon as a **different** command is sent meanwhile (`lastSentCommand` changed — the answer is not ours). The same command re-sent by a repeat tick does not cancel.

Used by `loadAllConfs`, `loadOneConf`, `showContact`, `kickOne`, `kickAll`, `hangupChannel`. Callers treat `null` as "do nothing" (kick/hangup still restore the view — see below).

`lastSentCommand` = `normalizeCommand(#astcmd)` (whitespace collapsed) recorded on **every** send: a capture-phase `click` listener on `#send` (runs before FreePBX's handler) plus Enter in `#astcmd`. That covers our sends, manual sends and repeat ticks.

## Output decoration (kick / hangup buttons) — observer-driven, live

Buttons are **not** injected by a timer after a click. `refreshOutput()` runs on every body mutation (and on highlight input): `unwrapHighlights` → `decorateOutput` → `linkifyOutput` → `highlightMatches`, with the observer disconnected during its own writes.

`decorateOutput(pre)` picks buttons by `lastSentCommand`:
- `confbridge list <conf>` → `kick` before each channel + summary line `.lazy-conf-summary` prepended at the top (`Зараз у конференції 5500: 3 учасники`, count = number of kick buttons) + `.lazy-kick-all` `ВИКИНУТИ ВСІХ (N)` at the bottom (only if ≥1 channel). It also rewrites the matching dropdown option's count (`updateConfOption`; locked flag kept in `option.dataset.locked`);
- `core show channels verbose` → `hangup` before each channel;
- plain `core show channels` → nothing.

It skips if `pre` already has a `.lazy-decor` element (all injected buttons carry it) → no duplicates. Because it follows the command, not the click, buttons survive every repeat re-render (live monitoring) and also appear for a hand-typed `confbridge list 5500`.

**KICK ALL confirmation:** first click only arms (`onKickAllClick` → `.armed`, label `Точно викинути всіх (N)? Натисни ще раз`), a second click within `KICK_ALL_CONFIRM_MS` (4000) runs `kickAll`; the timer disarms. The armed state lives in module-level `kickAllArmedConf`, **not** in the button: in repeat mode the button is a new node every few seconds, and `renderKickAllButton` restores the armed look from that variable. Arming is per conference. No inline styles on the button — tests find it by `.lazy-kick-all`.

## Clickable channels / numbers in the output

`linkifyOutput(pre)` wraps every `TOKEN_REGEX` match in `<span class="lazy-token" data-value>`: channels (`CHANNEL_REGEX`) and stand-alone numbers (`NUMBER_TOKEN`: 3–15 digits, optional `+`, bounded so ports `:5061`, times `00:01:23`, IPs, and the `/200-` inside a channel are skipped). It is idempotent (skips text inside `.lazy-token` / `.lazy-decor`) and must run **after** `decorateOutput`, because `injectChannelButtons` regexes `innerHTML` — it calls `unwrapTokens` first, otherwise it would match inside `data-value`. Tokens split text nodes, so a highlight query that spans a token boundary no longer matches (known limitation).

One delegated `document` click listener (`onDocumentClick`) opens `.lazyTokenMenu` (appended to `body`): «У поле «Номер»» puts `extractPeerName(value)` into `#peerInput` and focuses it (nothing is sent), «Підсвітити» puts the raw value into `#highlightInput`. Outside click / Escape closes; no menu if the user has a text selection. `extractPeerName` also reduces `Local/300@ctx-0001;1` → `300`.

## Dial into conference

`loadAllConfs` adds `#dialInput` + `.dialToConf` + `.confStatus` next to the dropdown (a half-typed number survives the rebuild). `dialIntoConf(conf, number)` sends `channel originate  Local/<n>@from-internal  extension <conf>@from-internal` (`DIAL_CONTEXT`) — through the FreePBX dialplan, so it works for internal and external numbers and the callee enters exactly as if they dialed the conf (PIN included). Asterisk prints **nothing** for originate, so there is no `sendAndWait`: `ORIGINATE_SETTLE_MS` (1000) → `loadOneConf`. `normalizeDialNumber` strips spaces/dashes/brackets and rejects anything but `+?[0-9*#]{2,20}` — no extra CLI args can sneak in. `channel originate` is in `isDestructiveCommand`, so repeat never re-dials.

After `kickOne` / `hangupChannel`: wait for the response → `SETTLE_MS` (500 ms; the channel leaves the bridge asynchronously, an instant re-read still shows it) → re-read the conf / calls. `kickAll` → re-read the whole conference list (the conf is gone). They re-read **even on `null`**, so `#astcmd` always returns to a view command.

## Conferences

- `loadAllConfs` parses `confbridge list` rows with `CONF_ROW_REGEX` = name + Users + Marked + Locked columns (app_confbridge prints `"%-32s %6u %6u %-6s %s"`). No conferences = header only → warning. The old `/\d{3,}/` grabbed any 3+ digit run, including stale output — don't go back to it.
- Options read `5500 — 3 учасники` (+ ` 🔒` if locked); `value` is the bare name. Placeholder has `value=''` and is ignored on change.
- `selectedConf` keeps the chosen conf selected across list refreshes. `↻ Оновити` (`.refreshConf`) re-reads the selected conf (re-picking the same option fires no `change`), or the list if nothing is selected.
- `loadOneConf` on `No conference bridge named '…' found!` → `loadAllConfs()` (the dropdown is stale).

## Regex notes

- Channel regex `CHANNEL_REGEX` = `/\b((?:PJSIP|SIP|IAX2|DAHDI|Local)\/[^\s]+)/` (no `g` flag) — applied per line. **Only the first channel per line gets a button.** The `\b` matters: without it `SIP/…` matched inside `PJSIP/200-…`, the button got `SIP/200-…` and kick/hangup failed with "channel not found" on chan_pjsip.

## Repeat mode

`.onRepeat` toggles a `setInterval` that re-clicks `buttonCLI` every `repeatSeconds * 1000` ms (re-sends whatever is in `#astcmd`) — **except destructive commands** (`isDestructiveCommand`: `confbridge kick…`, `channel request hangup…`, `channel originate…`), which a tick skips; otherwise a live `ВИКИНУТИ ВСІХ` would kick everyone who joins, every N seconds. State lives in module-level `let isOnRepeat`, `let repeater`, `let repeatSeconds` (default 5). The `.test` CSS class flips on each toggle (violet pulsing active state).

- **Interval stepper:** `.repeatMinus` / `.repeatPlus` call `adjustRepeat(±1)`, clamped to a **1s minimum**. Adjusting **while active** tears down and rebuilds the interval via `startRepeater()` so the new cadence (and progress-bar speed) take effect immediately.
- **Dynamic label:** `updateRepeatLabel()` is the single source of truth — `Перестати повторювати` while active, otherwise `Відправляти раз в <N> <pluralizeSeconds(N)>`. `pluralizeSeconds` applies Ukrainian plural rules (1 секунду / 2-4 секунди / 5+ секунд). Called at init and on every toggle/adjust.
- **Countdown bar:** `.repeatProgress` / `.repeatProgress-fill` is shown only while active (`.active` class). `kickRepeatProgress()` resets width to 0% then animates to 100% over `repeatSeconds`s on every tick. **The `void offsetWidth` reflow between the two width writes is mandatory** — without it the browser coalesces both style mutations and the transition never runs.
- **Pause:** an active repeat pauses while `#astcmd` has focus (a tick would send a half-typed command) and while the tab is hidden (`document.hidden`, no point loading the PBX). `syncRepeatPause()` runs on `focus`/`blur` of `#astcmd` and on `visibilitychange`; state is `repeatPausedFor` (`'' | 'cli' | 'hidden'`, from `repeatPauseReason()`). Paused = interval cleared, bar reset, `.paused` on the button, label from `REPEAT_PAUSE_LABELS`. Resume = fresh countdown via `startRepeater()`; coming back from **hidden** also sends one tick at once (data is stale), from **cli** it does not. Each tick re-checks `repeatPauseReason()` as a safety net. The stepper does not restart the interval while paused.

## Peer row (pjsip show aor / endpoint / contact)

`.peerRow` — input `#peerInput` + buttons `.peerAor` (`pjsip show aor`), `.peerEndpoint` (`pjsip show endpoint`), `.peerContact` (`pjsip show contact`) + `.peerStatus` span for messages (hidden when empty, cleared on every peer action). Enter in the input = `pjsip show endpoint`. Empty/whitespace input is a no-op.

**`showContact` is two-step**: `pjsip show contact` needs the **full contact name** (`200/sips:200@192.168.0.50:50001;transport=TLS`), not the number. So it `await sendAndWait('pjsip show contacts')` (which clears `pre[2]` first), takes every `Contact:\s+(\S+)` token that starts with `<number>/` (so `2001/…` never matches `200`), picks the first (status says how many if >1; "не знайдено" status and no second command if 0), and sends `pjsip show contact <completed name>`.

**`completeContactName`**: `pjsip show contacts` prints aor/uri in a fixed-width column, so `;transport=TLS` gets cut at an arbitrary point (`;transpo`, `;transport=`, `;`, or right after the port). It finds the longest prefix of `CONTACT_TRANSPORT_SUFFIX` (`';transport=TLS'`, case-insensitive) the token ends with and replaces it with the full suffix; if none, appends the whole suffix; a token that already contains it is returned as-is. **Assumes every contact is TLS** — change the constant if a deployment differs.

**`extractPeerName`**: the commands take a **peer name** (`200`), not a channel (`SIP/200-000000a3`). If the input starts with `SIP/` or `PJSIP/`, the prefix and the last `-suffix` are stripped; otherwise the value is passed through as-is (so a hand-typed peer like `office-2` keeps its dash). This replaced the old dead `.loadExtensions` ("1 номер") button, which had no listener. A `.peerUnregister` (`sip unregister`) button lived here briefly and was removed — chan_pjsip has no equivalent single command.

## Tests

```bash
npm install      # one-time
npm test         # run once
npm run test:watch
```

Stack: **Vitest** + **jsdom** (used directly, not via `environment: 'jsdom'`). `bootDOM` passes `pretendToBeVisual: true` — otherwise jsdom reports `document.hidden === true` and every repeat tick would be paused; tests flip `hidden` with `Object.defineProperty` + a `visibilitychange` event. Both are `devDependencies` only — they never ship to the Chrome bundle.

### How the tests work

`tests/helpers.js` boots a fresh JSDOM with a FreePBX-shaped DOM (two `.container-fluid`s, three `<pre>`s, `#astcmd`, `#send`), **overrides `window.setTimeout` / `setInterval` to capture callbacks**, then injects `utils.js` and `main.js` as real `<script>` tags via `appendChild` (which fires `initExtension()` automatically).

Tests then call `window.kickAll(...)` etc. and assert against DOM state. Use `flushTimeouts()` to drain captured `setTimeout` callbacks deterministically.

Pattern for anything that waits for Asterisk: call the function → `respond(document, text)` (writes `pre[2]`, i.e. "FreePBX answered") → `await tick()` (Node `setTimeout 0`; drains the observers and `await`s). `flushTimeouts()` now means either **"Asterisk never answered"** (fires `RESPONSE_TIMEOUT_MS`) or **"settle elapsed"** (`SETTLE_MS` after kick/hangup). Use realistic Asterisk output (`confList(confRow(...))` helpers) — the conference parser relies on the real column layout.

`visual-tests/harness-mock.js` mimics real Asterisk too: header-only `confbridge list` when empty, a conference disappears when its last participant is kicked (`No conference bridge named '…' found!`), conf 5501 uses `PJSIP/` channels.

### jsdom v25 quirks to remember

- `el.innerText` **getter** returns `undefined` before any assignment (layout-dependent). Use `el.textContent.trim()` for initial-template reads.
- `el.innerText = 'x'` **setter** does NOT update `el.textContent` in jsdom 25 — only the `innerText` property. So after `repeatButton.innerText = 'Перестати повторювати'`, read it back via `innerText`, not `textContent`.
- For uniquely-styled dynamically-created elements (like `.lazy-kick-all`, whose label changes with the count and the armed state), find by class/dataset rather than by text content.

### Don't refactor production code for testability

The whole point of the suite is to catch behavior regressions in the **shipped** files. Do not split `main.js` into modules, do not wrap `initExtension()` to skip auto-run, do not add exports. If a test is awkward, fix the test, not the production code.

## What NOT to do

- **No `"type": "module"` in `manifest.json` script entries.** Breaks the shared script-scope.
- **No bundler / build step.** The extension loads the raw files.
- **Do not delete `utils.js`** or inline it into `main.js` without checking the manifest's load order.
- **Do not change `sendQuery`'s whitespace format** unless you also update every caller's expectations and every test's expected command string.
- **Do not bump jsdom to a major version blindly** — the `innerText` semantics may shift again.

## Manifest target

The manifest has **no** `permissions` / `host_permissions`: a declarative content script needs none (the old `"host_permissions": ["activeTab"]` was not even a valid match pattern, `scripting` was unused). A test guards this.

`content_scripts[0].matches` is `*://*/admin/config.php?display=cli*`, so the extension activates on the FreePBX CLI page of any PBX. To pin it to a single PBX, replace `*://*` with `http://<host>` (and keep the README in sync). Don't hard-code a real PBX address into the repo — it is public.
