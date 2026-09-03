# Troubleshooting

## Annual analytics aggregation fails strict null checks

- **Error:** TypeScript reports that a currency aggregate value may be `null` while building yearly contract totals.
- **Cause:** Analytics preserves unknown monetary values as `null`, even inside a known-currency group.
- **Fix:** Sum only known amounts and treat `null` as unavailable (`0` contribution) instead of weakening the aggregate type.

## Spending.gov.ua intermittently returns `fetch failed`

- **Error:** A small automatic payment-enrichment batch succeeds for most contracts but reports `fetch failed` for one contract.
- **Cause:** The public Spending endpoint occasionally closes or delays an individual request; a single-attempt client treated this transient network event as a final result.
- **Fix:** Retry network errors, HTTP 429, and HTTP 5xx up to four times with quadratic backoff. Keep non-retryable 4xx responses explicit and leave every contract eligible for the next daily check.

## Analytics cron times out after queue batching and Spending are enabled together

- **Error:** The authenticated `/api/cron/analytics` request reaches the 295–300 second timeout during a large reclassification backlog.
- **Cause:** Discovery, control feeds, SharePoint workspace refresh, multi-batch tender import, and Spending enrichment competed for one Function duration. The queue itself was durable, but the combined wall time could exceed the invocation limit.
- **Fix:** Run discovery/control feeds/SharePoint in `/api/cron/analytics`, queue import/reclassification in `/api/cron/analytics-import`, and Spending enrichment in hourly `/api/cron/spending`. The two analytics jobs run independently every five minutes; the import job has a 70-second budget. Queue leases and cursors preserve completed work between invocations.

## Finance waits for SharePoint and Prozorro before it can render

- **Error:** `/?workspace=finance` spends many seconds on «Збираємо дані · SharePoint і Prozorro», then shows a second financial loader.
- **Cause:** The root client always fetched `/api/dashboard` and refused to render its shell until the complete tender payload arrived. Only after that request did it read `workspace=finance` and start the confidential turnover request, creating an unrelated sequential waterfall.
- **Fix:** Resolve the authorized workspace in the server page. Render the lightweight finance shell and load its active turnover dataset directly for `workspace=finance`; load SharePoint, Prozorro, market, and competitor data only on the tender route.

## Reconnecting a Vercel integration returns HTTP 500

- **Error:** `Connect integration resource to project` returns HTTP 500 while the storage resource still lists the project, but its `environmentVariables` array is empty.
- **Cause:** Vercel retained stale project-connection metadata after the integration variables were removed, so creating a second connection collided with the incomplete one.
- **Fix:** Confirm the resource and project IDs, disconnect only that resource/project pair, then reconnect the same resource through the connections API with `envVarEnvironments: ["production"]` and `makeEnvVarsSensitive: true`. Verify that Production contains the injected variables and Preview remains empty.

## TypeScript still references a removed temporary Next.js route

- **Error:** `.next/dev/types/validator.ts` or `.next/types/validator.ts` reports `TS2307` for a page that was already deleted after a local visual check.
- **Cause:** Next.js route types are generated artifacts and can keep the old import after the temporary page is removed.
- **Fix:** Stop the local server, move only the stale `.next/dev` or `.next/types` directory out of the project, run `npx next typegen`, then rerun `npm run verify`; do not change application imports to satisfy stale generated types.

## Sensitive Vercel variable is empty after `vercel env pull`

- **Error:** A sensitive custom environment variable exists in `vercel env ls`, but the pulled `.env.local` contains an empty value and local JSON parsing fails.
- **Cause:** Vercel does not return a sensitive value after it is created; `env pull` can reproduce the key, not reveal its plaintext value.
- **Fix:** Validate only that the key exists remotely, keep a separately managed local value when local authentication is required, and make an absent verifier fail closed. Never downgrade a credential verifier from sensitive storage merely to make it downloadable.

## Default UAH currency display differs between server and browser ICU

- **Error:** React hydration logs error `#418` for text even though the numeric value is the same.
- **Cause:** Vercel's Node ICU formatted UAH as `₴`, while the browser's ICU used `грн` for the default `currencyDisplay: "symbol"`.
- **Fix:** Set `currencyDisplay: "narrowSymbol"` for exact UAH values rendered by both server and client; both runtimes then emit `₴` consistently.

## React hydration fails when an SVG chart contains dynamic `<title>` elements

- **Error:** Production logs `Minified React error #418` while the dashboard otherwise appears correct.
- **Cause:** React's server renderer treated dynamic SVG `<title>` nodes as document metadata and emitted them empty, while the browser client rendered their text, so hydration compared different trees.
- **Fix:** Put the accessible period/value label on each SVG group with `role="group"` and `aria-label`; keep the chart-level `role="img"`, and do not render dynamic `<title>` nodes inside the client chart.

## Contract references an award that has no persistable analytical row

- **Error:** `analytics_contracts_award_id_fkey` rejects an otherwise valid Tender/Contracting batch.
- **Cause:** Some direct/legacy Prozorro contracts contain an `awardID`, but the corresponding award lacks a supplier or canonical lot and is therefore intentionally not inserted into `analytics_awards`. Persisting its canonical ID on the contract created a dangling foreign key.
- **Fix:** Track the award rows actually persisted in the batch and set `analytics_contracts.award_id` only when the referenced row exists. Keep the upstream identifier in canonical provenance; do not invent a supplier, lot, or award merely to satisfy the relation.

## Перший analytics sync перевищує ліміт Vercel Function

- **Error:** HTTP 504 `FUNCTION_INVOCATION_TIMEOUT` після 300 секунд під час першого `/api/cron/analytics`.
- **Cause:** Один запуск поєднував discovery кількох днів, повне завантаження Tender/Contracting API і десятки нормалізованих SQL-upsert для кожної закупівлі. Початковий backfill не має гарантовано вміщатися в одну serverless invocation.
- **Fix:** Discovery та офіційні change-feed спочатку ідемпотентно записують ID у `analytics_sync_queue` і лише після цього просувають durable cursor. Окрема lease-захищена фаза обробляє `ANALYTICS_IMPORT_BATCH` записів за запуск; успішні видаляються, помилки отримують exponential backoff. Тому timeout не втрачає подію і backfill поступово наздоганяється.

## Vercel managed Neon values are empty in `vercel env pull`

- **Error:** `DATABASE_URL is required` after a successful Neon Marketplace install; the pulled file contains `DATABASE_URL=""`.
- **Cause:** Sensitive managed-integration values are injected into Vercel Functions but are not exposed by this Vercel CLI/env-pull path.
- **Fix:** Keep the canonical idempotent schema in `db/analytics-v2.sql`, include it in the two analytics function bundles with `outputFileTracingIncludes`, and let the authenticated cron/manual sync call `ensureAnalyticsV2Schema()` inside Vercel before acquiring sync leases. Local migration remains available whenever a non-redacted `DATABASE_URL` is intentionally supplied.

## Analytics import script is treated as CommonJS or rejects `server-only`

- **Error:** `Top-level await is currently not supported with the "cjs" output format` or the `server-only` marker throws before an analytics import starts.
- **Cause:** `tsx` inferred CommonJS from a package without an ESM type, and ordinary Node execution does not enable React's `react-server` export condition.
- **Fix:** Keep `"type": "module"` in `package.json` and run the package script, which sets `NODE_OPTIONS=--conditions=react-server`; do not invoke the TypeScript importer with bare `node`.

## A standalone fixture test cannot resolve a server alias

- **Error:** `ERR_UNSUPPORTED_RESOLVE_REQUEST` or `ERR_MODULE_NOT_FOUND` for `@/lib/...` while a standalone test imports a TypeScript server module.
- **Cause:** Plain Node and transpiled `data:` modules do not resolve the Next.js `@/*` alias. A pure fixture should not gain a server dependency; a deliberate server-module test still needs the project resolver.
- **Fix:** Keep deterministic helpers separate from server-only boundaries. When the server import is intentional, run the test through `tsx` with `NODE_OPTIONS=--conditions=react-server` so `tsconfig` aliases and the `server-only` condition are both respected.

## Local production smoke test cannot bind port 3000

- **Error:** `EADDRINUSE: address already in use :::3000` when starting `next start`.
- **Cause:** Another local Next.js project is already listening on the default port.
- **Fix:** Identify the listener with `lsof -nP -iTCP:3000 -sTCP:LISTEN`; do not kill an unrelated project. Start this app on an explicit free port such as `npm start -- -p 3001`.

## Neon query results fail a direct TypeScript cast

- **Error:** TS2352 reports that `NeonQueryPromise` cannot be converted directly to an analytics row array.
- **Cause:** The driver promise carries generic query metadata that does not structurally overlap a plain array even though its awaited runtime value is the row collection.
- **Fix:** Await the query first, then narrow through `unknown` at the database boundary; keep all row validation/conversion in `analytics-v2-store.ts`.

## JavaScript word boundaries miss Ukrainian place names

- **Error:** Territory tests classify `Київська область` as outside the target region.
- **Cause:** JavaScript `\b` word boundaries are ASCII-oriented and do not reliably detect boundaries around Cyrillic text.
- **Fix:** Match the Ukrainian location stems directly without `\b`, and keep explicit regression cases for Kyiv city, Kyiv oblast, and another oblast.

## Generated JSON lags behind an expanded TypeScript schema

- **Error:** TypeScript rejects the imported market snapshot after `MarketCoveragePoint` gains direction-level aggregates.
- **Cause:** The checked-in JSON was still the previous generated shape while the new generator had not completed yet.
- **Fix:** Treat the generated import as `unknown` at the validation boundary, regenerate the snapshot immediately, and keep the runtime cast localized to the API route.

## SmartTender closes bulk detail requests

- **Error:** `TypeError: fetch failed` with `UND_ERR_SOCKET` while downloading many tender details.
- **Cause:** SmartTender can close bursts of concurrent detail requests.
- **Fix:** Limit detail concurrency to four requests, retry with quadratic backoff, then run one sequential retry pass for the remaining failures.

## React hook lint rejects initial loader effect

- **Error:** `react-hooks/set-state-in-effect` and `react-hooks/preserve-manual-memoization` in the client dashboard.
- **Cause:** The effect called a callback that synchronously set loading state, and a memo depended on a new sliced array on every render.
- **Fix:** Start the initial fetch directly inside the effect and calculate the small, already-limited coverage list without manual memoization.

## Older Vercel CLI rejects log filters

- **Error:** `unknown or unexpected option: --level` when scanning deployment logs.
- **Cause:** Vercel CLI 48 only supports the `--json` flag for `vercel logs`; `--level`, `--since`, and `--no-follow` belong to newer command behavior.
- **Fix:** Start `vercel logs <deployment> --json`, generate a smoke-test request, inspect the streamed events, and stop the bounded log session.

## `npx tsc` resolves the obsolete package

- **Error:** `This is not the tsc command you are looking for` and an attempted install of `tsc@2.0.4`.
- **Cause:** The verification command ran from the parent Projects directory instead of the app directory, so `npx` could not see the local TypeScript dependency.
- **Fix:** Run type-check, lint, and build with the working directory set to `specservis-dashboard`.

## ExcelJS buffer types conflict with Node 24

- **Error:** ExcelJS rejects `Buffer<ArrayBufferLike>` during TypeScript checking, and the recursive cell normalizer infers `any`.
- **Cause:** ExcelJS 4 types target the older non-generic Node Buffer while the project uses Node 24 typings; recursive JSDoc inference also needs an explicit return type.
- **Fix:** Keep the runtime Buffer unchanged, narrow the compatibility cast only at `workbook.xlsx.load`, and explicitly type the cell normalizer as returning a string.

## ExcelJS pulls a vulnerable legacy UUID version

- **Error:** `npm audit` reports a high-severity vulnerability through ExcelJS → `uuid@8`.
- **Cause:** ExcelJS 4 declares an older UUID dependency even though its API is compatible with the fixed current release.
- **Fix:** Pin ExcelJS's nested `uuid` dependency to `11.1.1` with the package override and verify with `npm audit`.

## Anonymous SharePoint workbook download returns 403

- **Error:** The shared workbook URL opens in the signed-in browser, but a server-side download returns HTTP 403.
- **Cause:** The link depends on the user's Microsoft 365 session and is not an anonymous file URL.
- **Fix:** Use a read-only Microsoft Graph application with `Sites.Selected` access to download the workbook on the server; keep the bundled snapshot as an explicit fallback until the tenant credentials are configured.

## Prozorro detail returns 404 for a valid workbook tender number

- **Error:** `GET /api/2.5/tenders/UA-…` returns 404 even though the Excel row and its public SmartTender/Prozorro links are valid.
- **Cause:** For some tenders, the official detail endpoint accepts Prozorro's internal 32-character UUID rather than the public `UA-…` number.
- **Fix:** Resolve the UUID from the workbook's SmartTender reference through `PurchaseDetail/GetAnnouncement`, then fetch and persist the canonical detail strictly from the official Prozorro API. Keep the original `UA-…` number as the user-facing tender ID.

## Vercel rejects `CRON_SECRET` header whitespace

- **Error:** `The CRON_SECRET environment variable contains leading or trailing whitespace, which is not allowed in HTTP header values.`
- **Cause:** Piping the generated secret with `printf '%s\n'` stored the trailing newline as part of the Vercel environment variable.
- **Fix:** Remove the malformed value and add a newly generated secret with `printf '%s'` so no newline reaches Vercel.

## Excel hyperlink amounts parse as zero

- **Error:** The workbook visibly contains announced values, but every internal tender is exported with `value: 0`.
- **Cause:** ExcelJS represents those cells as hyperlink objects whose `text` property is numeric; the normalizer accepted only string `text` values.
- **Fix:** Normalize every non-null hyperlink `text` value recursively, then reconcile all 1,273 parsed rows against the workbook totals.

## SmartTender subscription sees only conditioning tenders

- **Error:** `SearchBySubscription=true` returns a narrow set dominated by HVAC tenders even though the supplied CPV files cover three directions.
- **Cause:** That endpoint applies the account's existing SmartTender subscription, not the complete company search rules supplied for the dashboard.
- **Fix:** Use `/Tenders/search` for the six selected procedure types, fetch details by ID, and classify the full result with the construction, service, and conditioning CPV/keyword profiles.

## A portalled panel renders in the wrong theme, or `position: fixed` lands off-screen

- **Error:** The competitor card opened black-on-black; earlier the explanation modal appeared far below the fold and could not be scrolled to, and hint bubbles were clipped by their card.
- **Cause:** Two separate consequences of the same move. (1) `.owner-stack` has `animation: owner-rise … both` whose keyframes set `transform` — with `fill-mode: both` the transform *persists*, and any non-`none` transform makes the element a containing block **even for `position: fixed`**, so `inset: 0` resolved against the whole page instead of the viewport. `overflow: hidden` on cards clipped absolutely positioned bubbles for the same family of reasons. (2) Escaping that with `createPortal(…, document.body)` moves the node out of `.owner-app`, so every rule written as `.owner-app .drawer …` and every custom property declared on `.owner-app` stops applying — the dark base theme from `globals.css` took over.
- **Fix:** Portal overlays into `<body>`, then make their styling independent of the app subtree: declare the palette on `:root`, not on `.owner-app`, and scope overlay rules to `.drawer` / `.owner-modal` directly. Also lock scrolling on `document.documentElement`, not `body` — the page scrolls on `<html>`.

## Deleting "unused" CSS breaks live rules

- **Error:** Filter tabs on «Тендери команди» stretched to 320 px each and overlapped the search box after an unused-CSS sweep.
- **Cause:** A line-based cleanup script treated `.orphan { … }` as a whole rule, but the file uses multi-line selector lists:
  ```
  .owner-filter-tabs,
  .owner-direction-tabs { display: flex; … }
  ```
  Deleting the last line took the declarations with it and left `.owner-filter-tabs,` dangling, which silently merged into the next surviving rule — so the tabs inherited `.owner-search`'s `width: min(320px,100%)`.
- **Fix:** Never delete CSS line-by-line. If a sweep already ran, diff the authored file against the last deployed stylesheet (`curl` the `/_next/static/.../*.css` chunk from production, normalise `>`/whitespace in selectors, and compare property *names* per selector) — substituted property sets are the signature of this bug. Restore the affected rules from that stylesheet.

## Refreshing закупівлі.xlsx from SharePoint by hand

- **Error:** The dashboard shows a snapshot that is days old and there is no automated sync.
- **Cause:** No Microsoft Graph application exists (`MICROSOFT_*` is unset locally and in Vercel), so `getSharePointData()` always falls back to the bundled snapshot. Separately, `dashboard@spec-servis.com.ua` gets **AccessDenied on the site page** (`/sites/msteams_d71ff2-`) yet **can read the file itself** — the workbook is shared with that account directly, not through site membership. Browsing the site therefore looks broken even though the file is reachable.
- **Fix (manual, ~2 minutes):** in a browser signed in as that account, run against the `specservis.sharepoint.com` origin:
  - locate it — `/_api/search/query?querytext='filename:закупівлі*'&selectproperties='Path,LastModifiedTime'` (search is security-trimmed, so a hit proves read access);
  - download it — `fetch("/sites/msteams_d71ff2-/_layouts/15/download.aspx?SourceUrl=" + encodeURIComponent(path))`, then save the blob;
  - rebuild with the real modification time, not the copy's mtime:
    `INTERNAL_EXPORTED_AT="<LastModifiedTime>" node scripts/build-internal-snapshot.mjs <file>`;
  - rebuild the market snapshot afterwards — `seenByTeam` is matched against the internal file, so stale internal data marks tenders as missed that the team already has.
- **Proper fix:** an Entra application with `Sites.Selected` granted on that one site. The code path in `src/lib/sharepoint.ts` is already written and switches on automatically once `MICROSOFT_TENANT_ID` / `CLIENT_ID` / `CLIENT_SECRET` are set.

## Competitor data looks empty on a recent publication window

- **Error:** Every completed tender in the last 30 days has exactly one bidder, so there is no competition to analyse.
- **Cause:** Two separate effects. Competitive procedures (`aboveThreshold`, `Спрощена закупівля`) take weeks to reach an award, so a recent publication window catches them mid-procedure; and about 81 % of relevant tenders are `Закупівля без використання електронної системи` — direct contracts that have one supplier by definition.
- **Fix:** Crawl an older publication window (`COMPETITOR_HISTORY_DAYS=120`) and keep only competitive procurement methods. Bids live in `lots[].bids[]` of the detail response, with `bidder.usreou`, `value.amount`, and `awards[].status === "active"` marking the winner.

## Snapshot silently hides most of the open market

- **Error:** The market page shows far fewer open tenders than the summary counters claim.
- **Cause:** The retention step capped every bucket per direction (120 missed, 80 review, 40 seen …), so 1 167 of 1 862 actionable tenders never reached the snapshot even though the aggregates counted them.
- **Fix:** Retain every actionable tender unconditionally and cap only closed history, then publish what was dropped in `retention` so the UI can state it. Lists in the UI page instead of slicing to a fixed 60.

## `vercel --prod` exits with ETIMEDOUT while the build succeeds

- **Error:** `request to https://api.vercel.com/v13/deployments/<id> failed, reason: read ETIMEDOUT` right after `Running TypeScript ...`.
- **Cause:** Only the CLI's status-polling connection dropped. The build keeps running on Vercel, so a non-zero exit code does not mean the deployment failed.
- **Fix:** Take the deployment id from the error line and confirm the real state with `npx vercel inspect <dpl_id>`; redeploy only if it is not `● Ready` with the production alias attached.

## Status regex counts a loss as a win

- **Error:** The snapshot reports 18 wins while the workbook contains only 6 rows with «Обрані переможцем».
- **Cause:** `countStatus(/обрано переможцем|переможець(?!.*інш)/)` matched «Інший переможець» — a competitor won — because the negative lookahead scans forward from the match and finds nothing after the final word. The same field was also computed a second time in the dashboard route with `/перемог/i`, which matches neither status, so the owner and a direction-scoped viewer saw different numbers.
- **Fix:** Classify statuses against the workbook's own «База» dictionary in `src/lib/workbook-dictionary.mjs`, not by substring guessing, and compute every aggregate once in `src/lib/internal-summary.mjs`. `scripts/test-workbook-dictionary.mjs` locks the win/loss grouping.

## Refusal reason regex matches «час» inside «участі»

- **Error:** 800 of 1,273 tenders are labelled with the reason «Ресурси / час», while the workbook's dropdown records that reason only 59 times.
- **Cause:** The classifier joined the status column into the text it scanned and tested `/…|час|…/`. «Відмова від участі» (772 rows) contains the substring «час» inside «участі», so almost every declined tender matched the first rule.
- **Fix:** Resolve the reason from the «КОМЕНТАРІЙ ДЛЯ ДОПИСУ» dictionary on the «База» sheet by exact normalized match. Free text keeps a separate `manual` code instead of being pushed into the nearest category, and an empty cell stays «Не вказано».

## Title keywords invent a registry for a direction that has none

- **Error:** The service manager sees 15 tenders even though only the capital-construction workbook is connected.
- **Cause:** The direction was derived from keywords in the tender title, so construction rows such as «Поточний ремонт системи опалення» were relabelled as service or conditioning.
- **Fix:** The direction comes from provenance — `parseInternalWorkbook(..., { registryDirection })`. One workbook is the registry of exactly one direction. Directions without a workbook show `RegistryNotice` instead of a silent zero.

## Internal snapshot package script is not defined

- **Error:** `npm run snapshot:internal` fails with `Missing script: snapshot:internal`.
- **Cause:** The builder exists as `scripts/build-internal-snapshot.mjs`, but package.json does not declare a shortcut.
- **Fix:** Run `node scripts/build-internal-snapshot.mjs` directly until a package shortcut is intentionally added.

## Microsoft Graph: `Resource not found for the segment 'root:'`

- **Error:** Every file request to SharePoint returned HTTP 400 with `BadRequest — Resource not found for the segment 'root:'`, no matter how the file name was encoded.
- **Cause:** The URL chained two colon-paths: `/sites/{host}:{/sites/CRM_Dev}:/drive/root:/{folder}/{file}`. Graph accepts a colon-path for the site *or* for the drive item, never both in one request. The file name and its Cyrillic characters had nothing to do with it — that was the misleading part, because the failure looks like an encoding problem.
- **Fix:** Resolve the site path to a composite site id once (`GET /sites/{host}:{path}?$select=id` → `host,guid,guid`), then address everything as `/sites/{id}/drive/root:/{folder}/{file}`. `src/lib/graph.ts` caches the id per process.

## A live sync that silently rolls the data backwards

- **Error:** Not a crash. Turning Graph on would have replaced 1 292 verified records with an older set, and tenders the team had already processed would have reappeared in «підтверджено не в Excel».
- **Cause:** The folder the app can read (`CRM_Dev/Tenders/Excels`) holds *manual copies*, not the team's working files. `закупівлі копия.xlsx` was stamped 05.08 21:22 UTC while the bundled snapshot came from the original at 06.08 08:37 UTC. "Live" is not automatically "newer".
- **Fix:** `getSharePointData()` compares the Graph file's `lastModifiedDateTime` with the bundled snapshot's `exportedAt` and serves whichever is newer, saying in the UI which one is in use. Timestamps in that message carry hours and minutes — both files can land on the same calendar day, and «копія (06.08) старша за зріз (06.08)» reads as a bug.

## Profit columns that are pure formula artefacts

- **Error:** `Реалізація проєктів` has «Прибуток» and «Рентабельність» filled in for every row. Showing them would have put a 100 % margin on the director's screen.
- **Cause:** They are formulas over «Орієнтовна собівартість», which is empty in all 267 rows. So profit equals the contract sum and profitability is exactly 1 everywhere.
- **Fix:** `parseProjectWorkbooks` never reads those two columns, and the page says why. A filled cell is not the same thing as a known number — check the inputs of any computed column before trusting it.

## Оновлення ринку не вміщалося у функцію

- **Симптом:** повний обхід Prozorro триває **11 хв 58 с** (31 день × 12 пошуків + деталі до 24 тисяч закупівель). Жодна serverless-функція стільки не живе, а 2,8-мегабайтний `src/data/market-snapshot.json` працюючий сайт переписати не може взагалі — це файл білду.
- **Причина:** повний обхід і не потрібен кожні три години. Змінюються лише останні дні; закупівля, опублікована три тижні тому, свій статус у минулому не переписує.
- **Fix:** `scripts/lib/market-builder.mjs` вміє два режими одним кодом — повний (руками, з машини) і частковий (3 останні дні, з функції). Результат лягає у Vercel Blob, а вбудований файл лишається запасним. Частковий прогін = **90 с**.
- **Що дало другу половину прискорення:** спершу оновлення тривало 181 с, бо запитувало деталі місця робіт для всіх ~2900 знайдених закупівель. Місце виконання — властивість самої закупівлі й з часом не змінюється, тому для вже відомих воно береться зі збереженого зрізу. Перепитуються тільки ті, де територія лишилась `unknown`: раптом замовник дозаповнив адресу.

## Правка в Excel не впливала на «підтверджено не в Excel»

- **Симптом:** рядок додали в `закупівлі.xlsx`, а закупівля далі висіла в пропущених.
- **Причина:** `seenByTeam` рахувався один раз під час збірки зрізу і зберігався в ньому. Тобто відповідь на питання «чи веде це команда» була заморожена на момент останнього повного обходу.
- **Fix:** правило зіставлення винесене в `scripts/lib/team-matcher.mjs` і застосовується **на кожному запиті** проти того Excel, що зараз у SharePoint. У сховище ринку поля покриття взагалі не пишуться — вони обчислювані, та ще й внутрішні, тож у publicly-readable блобі їм не місце.
- **Грабля при перенесенні:** `normalize`/`tokens`/`tokenSimilarity` треба було копіювати **дослівно**. Пороги 0,42 і 0,72 підібрані саме під міру Жаккара зі знаменником по об'єднанню множин і під викидання службових слів («роботи», «закупівля»). Написана «по памʼяті» схожа функція мовчки зсунула б покриття.
- **І грабля в перевірці:** перший тест «додали 3 пропущені — нічого не змінилось» був неправильним тестом, а не багом. Показник «не в Excel» рахується лише по відкритих закупівлях на цільовій території, а перші три рядки зі списку `missed` виявились закритими й поза Києвом.

## Живе покриття зробило дашборд повільним

- **Симптом:** після переходу на перерахунок покриття щоразу `/api/dashboard` віддавав відповідь за **10 с**.
- **Причина:** сам перерахунок займав 4,4 с. Виною — `tokenSimilarity`, яка на кожного кандидата будувала нову множину-об'єднання `new Set([...a, ...b])`, а кандидатів на кожну з 3 066 закупівель — сотні.
- **Fix (двома точними кроками, без зміни результату):**
  1. розмір об'єднання рахується арифметично `|A| + |B| − |A∩B|` — та сама величина, нуль алокацій;
  2. перед обчисленням схожості стоїть точна відсічка: Жаккар ніколи не перевищує `min(|A|,|B|) / max(|A|,|B|)`, тому якщо це відношення вже нижче за поріг (0,42 або 0,72), рахувати нічого. Найдешевша умова — збіг ЄДРПОУ при близькій сумі — перевіряється першою.
- **Результат:** 4 652 мс → 852 мс, **5,5×**, і **0 розбіжностей** на всіх 3 066 закупівлях проти дослівно відтвореної старої реалізації. Саме так і треба перевіряти такі оптимізації: не «схоже на правду», а порівнянням із попередньою реалізацією рядок за рядком. Межі правила закріплені в `scripts/test-team-matcher.mjs`.

## `<=` замість `<` оголосив живий файл застарілим

- **Симптом:** щойно вбудований запасний зріз перебудували з того самого файлу, який читається наживо, дашборд перемкнувся на запасну копію з повідомленням «копія старша за наш зріз», хоча це один і той самий файл.
- **Причина:** захист від відкату порівнював `Date.parse(live) <= Date.parse(bundled)`. При однакових мітках часу рівність трактувалась як «живе джерело старіше».
- **Fix:** строга нерівність. Відкочуватись треба лише тоді, коли живий файл **справді** старіший.

## Миттєва синхронізація зробила «холодний» запит удвічі дорожчим

- **Симптом:** після переходу на читання SharePoint на кожному запиті дашборд віддавав відповідь за 9–14 с.
- **Причина:** розібрана книга лежала лише в пам'яті процесу. На Vercel запити розкидані по багатьох екземплярах функції, тож майже кожен платив заново: завантаження 492 КБ (1,2 с) + розбір ExcelJS (0,8 с). До цього кеш був спільним (`unstable_cache`), тому розбір відбувався раз на 15 хвилин на всіх.
- **Fix:** повернути спільний кеш, але **ключем зробити час зміни файлу** — `unstable_cache(fn, ["...", lastModifiedDateTime])`. Перевірка мітки коштує ~150 мс і робиться завжди, а розбір ділиться між екземплярами. Змінили файл — інша мітка, інший ключ, свіжий розбір. Миттєвість збережена, повторний розбір зник.
- **Тримати обидва рівні:** пам'ять процесу для теплого екземпляра + спільний кеш для холодного.
- **Результат:** дашборд 9–14 с → 5–7 с, сторінка проєктів → 0,6–2,3 с. Те, що лишилось, — це переважно 3,2 МБ відповіді й очікування живого пульсу Prozorro, а не SharePoint.

## `as const` створив readonly tuple у нормалізаторі правил

- **Error:** TypeScript `TS4104`: readonly tuple не можна додати до масиву mutable tuples.
- **Cause:** `.map(() => [field, value] as const)` звузив елемент до readonly-типу, а наступна обробка очікувала змінюваний `[MonitoringTextField, unknown]`.
- **Fix:** задати тип результату без readonly через `.map<[MonitoringTextField, unknown]>(...)`. Це зберігає точний тип поля без конфлікту мутабельності.

## Читання моніторингу повторно запускало всю міграцію

- **Симптом:** перше відкриття нової сторінки моніторингу тривало 40–50 секунд, хоча сама вибірка містила лише десятки рядків.
- **Причина:** `GET /api/monitoring-v2` викликав `ensureAnalyticsV2Schema()`. У serverless кожен холодний екземпляр послідовно виконував усі SQL-оператори 654-рядкової ідемпотентної міграції перед звичайним читанням.
- **Fix:** міграція лишається у фоновому синхронізаторі, а read-only endpoint читає вже підготовлену схему. Після цього повне відкриття сторінки разом із головним дашбордом займає близько 6 секунд, а не майже хвилину.

## Vercel CLI 48 не підтримує фільтри історичних логів

- **Error:** `vercel logs ... --since 2h --level error --no-follow` завершується з `unknown or unexpected option: --level`.
- **Cause:** у Vercel CLI 48 команда `logs` показує лише нові runtime-події до п'яти хвилин і приймає фактично тільки `--json`; параметри `--since`, `--level` та `--no-follow` у цій версії відсутні.
- **Fix:** запустити `npx vercel logs <deployment-url> --json`, відтворити запит окремо й фільтрувати JSON локально; для завершення live-сеансу надіслати `Ctrl-C`.

## Повноекранний «Збираємо дані» перед моніторингом

- **Error**: пряме відкриття `?view=market` щоразу показувало повноекранний індикатор і чекало SharePoint перед появою моніторингу Prozorro.
- **Cause**: кореневий клієнтський дашборд безумовно завантажував важкий `/api/dashboard`, хоча моніторинг, аналітика, проєкти та робоча черга мають власні API і не використовують цей payload.
- **Fix**: серверна сторінка одразу маршрутизує незалежні модулі у легку оболонку з уже перевіреною роллю користувача; важкий dashboard лишився тільки для головної та «Тендерів команди». Останній успішний зріз моніторингу коротко зберігається у `sessionStorage` і показується миттєво, поки у фоні приходить свіже оновлення.

## Spending.gov.ua інколи повертає `fetch failed`

- **Симптом:** один із договорів у фоновому збагаченні не перевірявся через короткий мережевий збій, хоча інші договори того самого запуску оброблялися.
- **Причина:** публічний API Spending або мережевий маршрут може тимчасово не відповісти; одиничний запит без повтору перетворював транзитну помилку на помилку всього запису.
- **Fix:** запити мають до чотирьох спроб із наростаючою затримкою для мережевих помилок, HTTP 429 та 5xx. Постійні 4xx не повторюються, щоб не маскувати некоректні параметри.

## Аналітика чекала десятки секунд після відкриття

- **Симптом:** оболонка сторінки зʼявлялася одразу, але показники, матриця та деталізація будувалися близько 40 секунд.
- **Причина:** рушій для кожного постачальника, замовника та пари заново фільтрував усі участі, перемоги й договори. Це давало квадратичне зростання часу; додатково в БД бракувало зворотних індексів за `procurement_id`.
- **Fix:** участі, перемоги, договори й деталізація групуються за один прохід через `Map`; пошук переможців і пропозицій виконується через індексовані ключі. Для таблиць звʼязків додано індекси за закупівлею та договором.

## Моніторинг завершувався HTTP 504

- **Симптом:** `/api/monitoring-v2` обривався через 60 секунд навіть для сторінки на 50 рядків.
- **Причина:** lateral-вибірка шукала предмет закупівлі за `analytics_items.lot_id` для кожного лота, але індексу за `lot_id` не було. PostgreSQL багаторазово перечитував велику таблицю предметів.
- **Fix:** додано індекси за `lot_id`, кореневою закупівлею та останніми записами моніторингу. Контрольний продакшн-запит скоротився з 60,3 с до 2,4 с.

## Робоча черга повторно виконувала міграцію схеми

- **Симптом:** `/api/tender-workspace` відкривався приблизно за 11,8 секунди.
- **Причина:** звичайний GET перед читанням щоразу запускав повну ідемпотентну міграцію аналітичної БД.
- **Fix:** міграція виконується фоновим імпортом, а read-only endpoint лише читає підготовлені таблиці. Контрольний продакшн-запит скоротився до 1,45 с.

## API аналітики повертав 12 МБ зайвих даних

- **Симптом:** навіть після прискорення SQL сторінка довго чекала завантаження великої JSON-відповіді.
- **Причина:** API повертав тисячі детальних записів основних замовників для кожного контрагента, хоча інтерфейс показує лише першого; дублювалися також повні списки постачальників і замовників поряд із легкими фасетами.
- **Fix:** у зведенні лишається тільки лідер кожного рейтингу, для фільтрів використовуються компактні фасети, а повторне відкриття показує останній успішний зріз і тихо оновлює його у фоні.

## Кеш у памʼяті не працював між Vercel Functions

- **Симптом:** два однакові послідовні запити до аналітики обидва повністю перераховували дані.
- **Причина:** локальний `Map` належить одному екземпляру функції, а Vercel може скерувати наступний запит на інший екземпляр.
- **Fix:** відповідь кешується у Vercel Runtime Cache з коротким TTL та тегом інвалідації. Контрольний повторний запит скоротився приблизно з 10,1 с до 2,8 с; у браузері попередній зріз зʼявляється одразу.

## Серверний модуль авторизації не імпортується у CLI-тесті

- **Error:** прямий імпорт `src/lib/auth.ts` через `tsx -e` завершується повідомленням `server-only` про Client Component.
- **Cause:** пакет `server-only` розрахований на умови резолюції Next.js, яких немає у звичайному CLI-процесі.
- **Fix:** для локальної HTTP-перевірки не імпортувати модуль застосунку; створювати короткоживучий тестовий токен окремим Node-процесом за тим самим форматом і секретом, не виводячи токен у консоль.

## Суцільне Excel-вивантаження моніторингу повертало 503

- **Симптом:** звичайна сторінка моніторингу працювала, а Excel для кількох тисяч лотів завершувався HTTP 503.
- **Причина:** великий `LIMIT` змінював план складної вибірки з lateral-зв’язками та перевищував робочі межі одного запиту до БД.
- **Fix:** Excel збирається стабільними порціями по 500 рядків; довідники та службові зведення читаються лише для першої порції, тому наступні сторінки не повторюють зайві запити.

## `tsx -e` не підтримав top-level await

- **Error:** `Top-level await is currently not supported with the "cjs" output format` у короткому CLI-тесті Excel.
- **Cause:** eval-код `tsx` у цьому режимі компілюється як CommonJS.
- **Fix:** асинхронну перевірку загорнути в IIFE: `void (async () => { ... })()`.
