# CLAUDE.md — guide for future Claude sessions

## What this project is

**"Астеріск для лінивих"** — a Chrome Manifest V3 **content script** that injects helper UI into the FreePBX Asterisk CLI page. It does not have a build step, no bundler, no TypeScript, no framework. Two plain `<script>` files are loaded into the page in a fixed order via `manifest.json`.

Target URL (hard-coded in `manifest.json`): `http://192.168.0.200/admin/config.php?display=cli*` — adjust per deployment.

## File map

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest. Loads `utils.js` then `main.js` as content scripts on the FreePBX CLI page. |
| `utils.js` | Defines `sendQuery(command, number, optional)`. References `inputCLI` / `buttonCLI` (defined in `main.js`). |
| `main.js` | All UI and behavior. Auto-runs `initExtension()` at the bottom on load. |
| `style.css` | Button styling. |
| `hello.html` | Unused demo file. Ignore. |
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
- `document.querySelectorAll('pre')[2]` — the third `<pre>` is the FreePBX command-output region
  - `loadOneConf` **clears** `pre[2].innerHTML` to `''` before sending the new `confbridge list` command
  - `loadAllConfs` and `showCallsDetailed` **do not** clear

## Regex notes

- Conference-number regex (`loadAllConfs`): `/\d{3,}/g` — matches every run of 3+ digits in `pre[2]`. The header line of `confbridge list` does not contain a 3+ digit number, so it's safe.
- SIP-channel regex (`loadOneConf`, `showCallsDetailed`): `/(SIP\/[^\s]+)/` (no `g` flag) — applied per line via `lines.map(line => line.replace(regex, ...))`. **Only the first SIP id per line gets a button.** That matches FreePBX output where each user is on its own line.

## Repeat mode

`.onRepeat` toggles a `setInterval` that re-clicks `buttonCLI` every `repeatSeconds * 1000` ms (re-sends whatever is in `#astcmd`). State lives in module-level `let isOnRepeat`, `let repeater`, `let repeatSeconds` (default 5). The `.test` CSS class flips on each toggle (violet pulsing active state).

- **Interval stepper:** `.repeatMinus` / `.repeatPlus` call `adjustRepeat(±1)`, clamped to a **1s minimum**. Adjusting **while active** tears down and rebuilds the interval via `startRepeater()` so the new cadence (and progress-bar speed) take effect immediately.
- **Dynamic label:** `updateRepeatLabel()` is the single source of truth — `Перестати повторювати` while active, otherwise `Відправляти раз в <N> <pluralizeSeconds(N)>`. `pluralizeSeconds` applies Ukrainian plural rules (1 секунду / 2-4 секунди / 5+ секунд). Called at init and on every toggle/adjust.
- **Countdown bar:** `.repeatProgress` / `.repeatProgress-fill` is shown only while active (`.active` class). `kickRepeatProgress()` resets width to 0% then animates to 100% over `repeatSeconds`s on every tick. **The `void offsetWidth` reflow between the two width writes is mandatory** — without it the browser coalesces both style mutations and the transition never runs.

## Peer row (pjsip show aor / endpoint / contact)

`.peerRow` — input `#peerInput` + buttons `.peerAor` (`pjsip show aor`), `.peerEndpoint` (`pjsip show endpoint`), `.peerContact` (`pjsip show contact`) + `.peerStatus` span for messages (hidden when empty, cleared on every peer action). Enter in the input = `pjsip show endpoint`. Empty/whitespace input is a no-op.

**`showContact` is two-step**: `pjsip show contact` needs the **full contact name** (`200/sips:200@192.168.0.50:50001;transport=TLS`), not the number. So it clears `pre[2]`, sends `pjsip show contacts`, and after 1000 ms reads `pre[2].textContent`, takes every `Contact:\s+(\S+)` token that starts with `<number>/` (so `2001/…` never matches `200`), picks the first (status says how many if >1; "не знайдено" status and no second command if 0), and sends `pjsip show contact <completed name>`.

**`completeContactName`**: `pjsip show contacts` prints aor/uri in a fixed-width column, so `;transport=TLS` gets cut at an arbitrary point (`;transpo`, `;transport=`, `;`, or right after the port). It finds the longest prefix of `CONTACT_TRANSPORT_SUFFIX` (`';transport=TLS'`, case-insensitive) the token ends with and replaces it with the full suffix; if none, appends the whole suffix; a token that already contains it is returned as-is. **Assumes every contact is TLS** — change the constant if a deployment differs.

**`extractPeerName`**: the commands take a **peer name** (`200`), not a channel (`SIP/200-000000a3`). If the input starts with `SIP/`, the prefix and the last `-suffix` are stripped; otherwise the value is passed through as-is (so a hand-typed peer like `office-2` keeps its dash). This replaced the old dead `.loadExtensions` ("1 номер") button, which had no listener. A `.peerUnregister` (`sip unregister`) button lived here briefly and was removed — chan_pjsip has no equivalent single command.

## Tests

```bash
npm install      # one-time
npm test         # run once
npm run test:watch
```

Stack: **Vitest** + **jsdom** (used directly, not via `environment: 'jsdom'`). Both are `devDependencies` only — they never ship to the Chrome bundle.

### How the tests work

`tests/helpers.js` boots a fresh JSDOM with a FreePBX-shaped DOM (two `.container-fluid`s, three `<pre>`s, `#astcmd`, `#send`), **overrides `window.setTimeout` / `setInterval` to capture callbacks**, then injects `utils.js` and `main.js` as real `<script>` tags via `appendChild` (which fires `initExtension()` automatically).

Tests then call `window.kickAll(...)` etc. and assert against DOM state. Use `flushTimeouts()` to drain captured `setTimeout` callbacks deterministically.

### jsdom v25 quirks to remember

- `el.innerText` **getter** returns `undefined` before any assignment (layout-dependent). Use `el.textContent.trim()` for initial-template reads.
- `el.innerText = 'x'` **setter** does NOT update `el.textContent` in jsdom 25 — only the `innerText` property. So after `repeatButton.innerText = 'Перестати повторювати'`, read it back via `innerText`, not `textContent`.
- For uniquely-styled dynamically-created elements (like the KICK ALL button with `style.color = 'red'`), prefer finding by style/dataset rather than by text content.

### Don't refactor production code for testability

The whole point of the suite is to catch behavior regressions in the **shipped** files. Do not split `main.js` into modules, do not wrap `initExtension()` to skip auto-run, do not add exports. If a test is awkward, fix the test, not the production code.

## What NOT to do

- **No `"type": "module"` in `manifest.json` script entries.** Breaks the shared script-scope.
- **No bundler / build step.** The extension loads the raw files.
- **Do not delete `utils.js`** or inline it into `main.js` without checking the manifest's load order.
- **Do not change `sendQuery`'s whitespace format** unless you also update every caller's expectations and every test's expected command string.
- **Do not bump jsdom to a major version blindly** — the `innerText` semantics may shift again.

## Manifest target

If a deployment uses a different FreePBX host, update `manifest.json` → `content_scripts[0].matches` and also `host_permissions` if needed. Test page URL pattern: `http://<host>/admin/config.php?display=cli*`.
