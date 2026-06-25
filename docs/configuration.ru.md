# Справочник по конфигурации

🌍 [English](./configuration.md) · **Русский**

Полный референс по ручной настройке proxitor. Если не хочется править файлы — интерактивное меню (`proxitor config`) покрывает большую часть этого и использует живые данные OpenRouter. Быстрый старт см. в [README](./README.ru.md).

Шаблон с комментариями — [`proxitor.config.example.yaml`](../proxitor.config.example.yaml).

## Где лежит конфиг

Proxitor ищет файл конфигурации в таком порядке:

```
proxitor.config.yaml  →  proxitor.config.yml  →  proxitor.config.json
.proxitor.yaml        →  .proxitor.yml         →  .proxitor.json
```

**Приоритет:** флаги CLI > файл конфигурации > переменные окружения > значения по умолчанию.

## Тип аутентификации

По умолчанию proxitor отправляет API-ключ как `Bearer`-токен (`Authorization: Bearer sk-...`). Для кастомного прокси-провайдера, который ждёт заголовок `OAuth`, задайте `authType: oauth`:

```yaml
authType: oauth    # "bearer" (по умолчанию) или "oauth"
```

Заголовок поменяется на `Authorization: OAuth sk-...`.

## Кастомный URL API и фолбэк данных

При использовании кастомного `openrouterBaseUrl`, указывающего на сторонний сервис, тот может не поддерживать специфичные эндпоинты OpenRouter вроде `/providers` или `/models/{author}/{slug}/endpoints`. Proxitor обрабатывает это автоматически:

- **Автоматический фолбэк** — если кастомный API вернул ошибку (4xx/5xx) или неожиданный формат ответа для data-эндпоинтов, proxitor откатывается на `https://openrouter.ai/api` (API-ключ не нужен — эти эндпоинты публичные).
- **`openrouterDataUrl`** — задайте явно основной URL для загрузки данных, независимо от `openrouterBaseUrl` (который используется для проксирования запросов).

```yaml
# Запросы идут на кастомный сервис, загрузка данных откатывается на OpenRouter.
# ВАЖНО: НЕ добавляйте /v1 в базовый URL — пути запросов вроде /v1/chat/completions
# форвардятся как есть, поэтому /v1 задвоится.
openrouterBaseUrl: 'https://custom-service.example.com/api'

# Основной URL данных явно (опц., по умолчанию равен openrouterBaseUrl).
# openrouterDataUrl: 'https://openrouter.ai/api'
```

При срабатывании фолбэка proxitor пишет предупреждение: `Custom API did not return providers, using OpenRouter as fallback`.

## Маршрутизация провайдеров

Управляйте, какой провайдер обслуживает запросы. Все три опции принимают строку или массив:

```yaml
# Жёсткая фиксация — только этот провайдер, без фолбэков
provider:
  only: "anthropic"

# Ограниченный пул — балансировка только между этими провайдерами
provider:
  only:
    - "anthropic"
    - "deepinfra"

# Порядок приоритета — сначала Anthropic, при недоступности фолбэк на остальных
provider:
  order: "anthropic"
  allowFallbacks: true

# Строгий порядок — перебор по списку, без фолбэков вне списка
provider:
  order:
    - "anthropic"
    - "deepinfra"
  allowFallbacks: false

# Чёрный список — никогда не использовать этих провайдеров
provider:
  ignore: "azure"
```

| Опция | Поведение |
|---|---|
| `only` | Ограничение перечисленными провайдерами. Балансирует по цене внутри списка. Никогда не уходит за пределы — если все недоступны, запрос падает. |
| `order` | Перебор провайдеров в указанном приоритете. Если ни один не сработал, фолбэк на другие доступные (если только `allowFallbacks: false`). |
| `ignore` | Никогда не направлять запросы перечисленным провайдерам. |

Без `provider` запросы форвардятся без изменений.

Полный список поддерживаемых провайдеров и опций — в [документации маршрутизации OpenRouter](https://openrouter.ai/docs/guides/routing/provider-selection).

### Продвинутые опции провайдеров

```yaml
provider:
  sort: "throughput"          # сортировка: price | throughput | latency
  quantizations:
    - "fp8"                   # фильтр по уровню квантизации
  maxPrice:
    prompt: 1                 # $/M токенов
    completion: 2
  requireParameters: true     # только провайдеры, поддерживающие все параметры запроса
  dataCollection: "deny"      # "allow" | "deny"
  zdr: true                   # принудительный Zero Data Retention
  preferredMinThroughput:
    p90: 50                   # токенов/сек (мягкий порог)
  preferredMaxLatency:
    p90: 3                    # секунды (мягкий порог)
```

## Переопределения по моделям

Маршрутизируйте разные модели по-разному. Ключи — точные имена или префиксные маски. Более специфичные совпадения выигрывают.

```yaml
provider:
  order: "deepinfra"   # глобальное значение по умолчанию

modelOverrides:
  # Точное совпадение — зафиксировать эту модель на Anthropic
  "claude-sonnet-4-6":
    provider:
      only: "anthropic"

  # Маска — все claude-* предпочитают Anthropic с фолбэком
  "claude-*":
    provider:
      order:
        - "anthropic"
        - "deepinfra"

  # GPT-модели на OpenAI/Azure плюс кастомный заголовок
  "gpt-*":
    provider:
      only:
        - "openai"
        - "azure"
    headers:
      X-Model-Family: "gpt"
```

**Приоритет совпадения:** полное точное имя > префиксная маска > совпадение по слагу (bare-имя ↔ с префиксом вендора) > префикс слага.

Имя модели матчится с префиксом вендора или без: bare `kimi-k2.6` соответствует ключу оверрайда `moonshotai/kimi-k2.6`. Датированный или вариантный суффикс требует явного `*` — `moonshotai/kimi-k2.6-20260420` матчится на `moonshotai/kimi-k2.6*`, а не на bare-ключ `moonshotai/kimi-k2.6`, — поэтому `gpt-4` не перехватит `gpt-4o`. Префикс вендора различает вендоров: `openai/gpt-4o` матчит bare `gpt-4o`, но никогда — `azure/gpt-4o` другого вендора. Входящее имя модели уходит upstream без изменений.

> **Коллизии одинаковых слагов:** если несколько ключей оверрайда имеют одно имя модели у разных вендоров (напр. `openai/gpt-4o` и `azure/gpt-4o`), а Claude Code шлёт bare-имя, proxitor разрешает его в один ключ — bare-ключ, если он есть, иначе первый объявленный с префиксом (предупреждение называет этот ключ). `proxitor` предупреждает один раз при старте и в `proxitor doctor`; чтобы выбрать конкретного вендора, шлите имя с префиксом.

## Кастомные заголовки

Добавляйте заголовки ко всем проксируемым запросам или по моделям (наследуются поверх глобальных):

```yaml
headers:
  X-Custom-Header: "my-value"
  X-Environment: "production"

modelOverrides:
  "claude-*":
    headers:
      X-Custom-Header: "claude-override"  # перекрывает глобальное значение
      X-Extra: "only-for-claude"          # добавляется только для этой модели
```

## Кэширование подсказок

Кэширование подсказок **привязано к провайдеру**: кэш, собранный на Anthropic, не поможет, когда следующий запрос уйдёт на другого провайдера. Три настройки формирования запроса позволяют кэшированию переживать между запросами. Думайте о них как о **рычагах** — большинству сетапов хватает первых двух.

| Рычаг | Поле | По умолчанию | Что делает |
| --- | --- | --- | --- |
| **Активировать кэширование** | `cacheControl` | `auto` | Внедряет `cache_control`, чтобы апстрим закэшировал промпт (провайдеры, нативные для Anthropic) |
| **Зафиксировать провайдера** | `sessionId` | `auto` | Внедряет `session_id`, чтобы маршрутизация липла с первого запроса — без «дрожания» провайдера, сбрасывающего кэш |
| **Стабилизировать префикс** | `normalizeVolatileSystem` | `false` | Вырезает волатильные хэши `cch` и `cc_version` из Claude Code из системного промпта, чтобы префикс перестал меняться (не-Anthropic провайдеры) |

**Эмпирическое правило:** моделям Anthropic нужны рычаги **1+2**; не-Anthropic провайдерам (qwen / glm / и т.д. за Claude Code) нужны **все три**.

`cacheControlTtl` (ниже) — подопция рычага 1 — она управляет внедряемым `cache_control.ttl`, а не отдельным рычагом.

**`cacheControl`** — внедряет `cache_control: { "type": "ephemeral" }` в тело запроса. OpenRouter использует это для расстановки точек кэша и их продвижения по мере роста диалога.

**`cacheControlTtl`** (`5m` / `1h` / `omit` / `skip`, по умолчанию отсутствует = passthrough) — управляет полем `ttl` во внедрённом `cache_control` (только для эндпоинтов Anthropic). TTL действует только при активном кэшировании (`cacheControl` равен `auto`/`always`); в редакторе задаётся независимо от режима кэша.

**`rewriteBlockTtl`** (`auto` / `always` / `skip`, по умолчанию `skip`) — приводит `ttl` на **блочных** `cache_control`-брейкпойнтах, которые клиент уже расставил (в `system`, `tools`, `messages[].content`), к значению `cacheControlTtl`. Claude Code шлёт эти блоки в основном без `ttl` (Anthropic считает их `5m`); если вы зададите `cacheControlTtl: 1h`, запрос уйдёт с прокси с `1h` на корне и `5m` на блоках — смешанные TTL, которые Anthropic отклоняет. `rewriteBlockTtl` это чинит.

| Режим | Поведение |
| --- | --- |
| `skip` (по умолчанию) | Не трогает клиентский блочный `ttl`. Рассинхрон возможен — оставляйте, только если блоками должен управлять клиент. |
| `auto` | Переписывает блочный TTL в `cacheControlTtl` на эндпоинтах, нативных для Anthropic (при активном кэшировании). |
| `always` | Переписывает блочный TTL на всех эндпоинтах. |

Значение берётся из `cacheControlTtl` (`5m` / `1h` / `omit`) и переписываются только **существующие** брейкпойнты — новые не добавляются, поэтому лимит Anthropic в ≤4 брейкпойнта и расстановка клиента соблюдаются. Включается через `proxitor config` → **💾 Caching** → Activate caching → *Rewrite block TTLs* (третий шаг: режим → TTL → переписывать ли блочный TTL), или per-model в редакторе переопределений.

> **Примечание:** одного `cacheControlTtl: 1h` **недостаточно** — `rewriteBlockTtl` тоже должен быть `auto` или `always`.

```yaml
cacheControl: auto
cacheControlTtl: 1h
rewriteBlockTtl: auto   # привести блочные брейкпойнты к 1h (чинит отказ Anthropic со смешанным ttl)

modelOverrides:
  "claude-opus-*":
    rewriteBlockTtl: skip   # оставить блочный TTL Opus как шлёт клиент
```

**`sessionId`** — внедряет `session_id` для «липкой» маршрутизации к провайдеру. Без него OpenRouter привязывается к провайдеру только после фиксации попадания в кэш. С ним маршрутизация липнет с **первого запроса** — критично для моделей OpenAI, где отложенное кэширование означает 0 закэшированных токенов на первых 1-2 запросах.

И `cacheControl`, и `sessionId` поддерживают режимы `auto` / `always` / `skip`:

| Режим | `cacheControl` | `sessionId` |
| --- | --- | --- |
| `auto` (по умолчанию) | Модели Anthropic на `/v1/chat/completions`; все модели на `/v1/messages` и `/v1/responses` | Прокидывает client session ID, если есть; иначе генерирует proxy UUID |
| `always` | Все модели, все эндпоинты | Всегда генерирует proxy session ID, игнорируя клиентский |
| `skip` | Passthrough: не трогает клиентский `cache_control`, ничего не внедряет | Passthrough: не трогает клиентские заголовки сессии |

Значения `cacheControlTtl`:

| Значение | TTL | Цена записи | Когда использовать |
| --- | --- | --- | --- |
| _(отсутствует)_ | Passthrough: сохранить клиентский `ttl`, ничего не добавлять; per-model absent наследует глобальный TTL | — | По умолчанию |
| `5m` | 5 минут (значение Anthropic по умолчанию) | 1.25× | Явный короткий кэш; частые запросы (>1 за 5 мин) |
| `1h` | 1 час | 2.0× | Редкие или долгие сессии |
| `omit` | Вырезать поле `ttl`, гарантированно без TTL (даже присланный клиентом) | — | Принудительно выключить TTL |
| `skip` | Passthrough: сохранить клиентский `ttl`, ничего не добавлять, игнорировать унаследованное | — | Игнорировать глобальный TTL без вырезания |

> **Примечание:** `null` (ранее принимался в model overrides для отмены унаследованного TTL) **удалён** — мигрируйте на `skip`. `null` был недокументирован и не выставлялся из UI.

```yaml
cacheControl: auto    # безопасное значение по умолчанию — только Anthropic и безопасные эндпоинты
sessionId: auto       # всегда обеспечивает липкую маршрутизацию (клиентский заголовок или proxy UUID)

# Кэш на 1 час для всех моделей Anthropic (дороже запись, длиннее TTL)
cacheControlTtl: 1h

# Принудительное кэширование для всех моделей (может дать 400 на не-Anthropic /v1/chat/completions)
# cacheControl: always

# Переопределения по моделям — TTL поддерживает '5m', '1h', 'omit' или 'skip' (passthrough)
modelOverrides:
  "gpt-*":
    cacheControl: skip        # OpenAI кэширует автоматически, внедрение не нужно
    sessionId: always         # но липкая маршрутизация всё равно помогает
  "claude-opus-*":
    cacheControlTtl: skip     # passthrough для Opus — игнорировать глобальный 1h, брать клиентский ttl
```

**Почему важны рычаги:**

- **Модели Anthropic** — рычаг 1 (`cache_control`) активирует кэширование, `cacheControlTtl` продлевает его свыше 5 мин, рычаг 2 (`session_id`) предотвращает «дрожание» провайдера, которое бы его инвалидировало.
- **Модели OpenAI** — кэширование автоматическое (рычаг 1 не нужен), но рычаг 2 (`session_id`) обеспечивает липкую маршрутизацию с запроса №1 вместо ожидания попадания в кэш.
- **Не-Anthropic модели за Claude Code (qwen / glm / …)** — рычаг 3 (`normalizeVolatileSystem`) стабилизирует префикс; без него меняющиеся хэши `cch`/`cc_version` не дают префиксному кэшу согреться.
- **Все модели** — рычаг 2 (`session_id`) предотвращает переключение провайдера, которое молча сбрасывает кэш.

## Наблюдаемость кэша

Пока proxitor работает, он печатает **классифицированную строку кэша на каждый запрос** для каждого проксированного ответа (non-streaming JSON и стриминговый SSE), чтобы сразу было видно, помогает ли кэширование. Настройка не нужна — включено по умолчанию.

```
[a1b2] HIT   99%  read 48640  in 48874  glm-4.5-air  [main]
[c3d4] PARTIAL  42%  read 1088  in 2600  claude-sonnet-4-6  provider=anthropic  [side]
[e5f6] MISS   read 0  in 48874  glm-4.5-air  provider=novita  [main]
[g7h8] COLD   read 0  in 48874  glm-4.5-air  [main]
[i9j0] NOUSAGE   claude-sonnet-4-6  [main]
```

Каждая строка несёт ID запроса, **метку**, процент попадания (для `HIT`/`PARTIAL`), `read N` / `write N` токенов при наличии, `in N` входных токенов, модель, `provider=…` при наличии метаданных маршрутизации и тип запроса `[main]`/`[side]`.

### Метки

| Метка | Значение |
| --- | --- |
| `HIT` | Чтение из кэша ≥ `hitThreshold`% от входных токенов — тёплый, полезный кэш. |
| `PARTIAL` | Часть читается из кэша, но ниже порога. |
| `MISS` | Нет чтения из кэша на **повторном** запросе в той же сессии — кэш должен был обслужить его, но не сделал. |
| `COLD` | Нет чтения из кэша на **первом** запросе в сессии — ожидаемая разовая стоимость прогрева. |
| `NOUSAGE` | Объект usage не наблюдался (нелогируемый content-type, битый ответ и т.п.). |

### Тип запроса

Каждый запрос помечается `[main]` или `[side]`. Запрос помечается `[side]`, только если у него **нет инструментов** и его `max_tokens` не превышает `sideMaxTokens` — правило по двум сигналам, чтобы не помечать мелкие запросы без инструментов как основной ход. Всё остальное — `[main]`.

**Резолв `max_tokens`:** бюджет использует `max_tokens ?? max_completion_tokens`. Если ни того, ни другого нет, запрос по умолчанию помечается `[main]` (безопасное поведение), а не `[side]`.

### Конфигурация

Все опции лежат под `observability:` и опциональны, с разумными значениями по умолчанию.

```yaml
observability:
  routerMetadata: true      # отправлять x-openrouter-metadata, чтобы видеть обслуживающего провайдера
  hitThreshold: 80          # cacheRead/inputTokens % при или выше => HIT
  sideMaxTokens: 4096       # запрос без инструментов с max_tokens <= этого => [side]
  sessionMaxEntries: 4096   # ёмкость трекера сессий в памяти (вытеснение FIFO)
  sessionTtlMs: 600000      # TTL записи трекера сессий (10 минут)
```

| Опция | По умолчанию | Описание |
| --- | --- | --- |
| `routerMetadata` | `true` | Включает `x-openrouter-metadata` от прокси, чтобы ответы показывали, какой провайдер реально обслужил запрос (видно как `provider=…` в строке кэша, когда доступны метаданные маршрутизации/обслуживающего провайдера). Поставьте `false`, чтобы отключить. |
| `hitThreshold` | `80` | Процент `cacheRead / inputTokens`, при или выше которого запрос помечается `HIT`. |
| `sideMaxTokens` | `4096` | Запрос **без инструментов** И с `max_tokens` не выше этого бюджета помечается `[side]`. |
| `sessionMaxEntries` | `4096` | Ограниченная ёмкость трекера сессий в памяти (вытеснение FIFO при превышении). |
| `sessionTtlMs` | `600000` | Время жизни записи трекера сессий (10 минут). |

### Обогащённые дампы

Установите `PROXITOR_DUMP_BODY=1`, чтобы писать дампы запроса/ответа (в `~/.cache/proxitor/dumps`, переопределяется через `PROXITOR_DUMP_DIR`). При включении объект `response` в каждом дампе обогащается классифицированным наблюдением:

```json
"response": {
  "status": 200,
  "label": "HIT",
  "requestType": "main",
  "model": "glm-4.5-air",
  "sessionId": "8f3e...",
  "toolsCount": 0,
  "inputTokens": 48874,
  "cacheRead": 48640,
  "cacheCreate": 0,
  "hitPct": 99.5,
  "provider": "novita",
  "strategy": "priority",
  "region": null,
  "attempt": 1,
  "fallback": false,
  "generationId": "gen-..."
}
```

`provider`, `strategy`, `region`, `attempt`, `fallback` и `generationId` заполняются, только если присутствуют метаданные маршрутизации (т.е. `routerMetadata` включён и апстрим их вернул).

## normalizeVolatileSystem (стабильный префикс для не-Anthropic провайдеров)

Claude Code встраивает в системный промпт волатильные хэши `cch=…` (за ход) и `cc_version=<semver>.<hash>` (за сборку), которые меняются (почти) на каждом ходу. Для **нативных для Anthropic** провайдеров это безвредно — ключ кэша его поглощает. Но для **не-Anthropic** провайдеров (qwen, glm и других, маршрутизируемых через OpenRouter), эти меняющиеся байты лежат внутри кэшируемого префикса, поэтому префиксный кэш никогда не согревается и каждый ход платит полную цену.

`normalizeVolatileSystem` вырезает эти волатильные хэши из `messages[0]` (системного блока), чтобы байты префикса оставались стабильными от хода к ходу. Читаемый semver в `cc_version` сохраняется; схлопывается только дрейфящий хэш сборки.

```yaml
normalizeVolatileSystem: true   # вырезать волатильные хэши cch/cc_version из системного промпта
```

- **Включать, когда:** вы маршрутизируете Claude Code через не-Anthropic провайдера, а лог cache-read держится около нуля.
- **Не влияет на:** нативное кэширование Anthropic (там хэш безвреден) — безопасно держать включённым глобально.
- **Per-model:** незаданное значение наследует глобальное.

```yaml
modelOverrides:
  "qwen-*":
    provider:
      only: "qwen"          # не-Anthropic провайдер
    normalizeVolatileSystem: true
```

Переключается из меню (`proxitor config` → **💾 Caching** → Stabilize prefix) или через `proxitor config cache`.

## Интерактивный менеджер конфигурации

### Мастер настройки

```sh
proxitor config wizard
```

Мастер спрашивает:

- **API-ключ OpenRouter** — сохраняется в конфиг или задаётся как переменная `OPENROUTER_API_KEY`
- **Порт** — по умолчанию `8828` (избегает конфликтов с типичными dev-серверами на 8080)
- **Адрес прослушивания** — все интерфейсы (`0.0.0.0`), только localhost (`127.0.0.1`) или свой адрес (IP, hostname или `unix:/path`)
- **Базовый URL API** — по умолчанию `https://openrouter.ai/api`; меняется для self-hosted или кастомных эндпоинтов
- **Тип аутентификации** — `bearer` (по умолчанию) или `oauth`; `oauth` — для кастомных прокси-провайдеров, передающих токен в заголовке `Authorization: OAuth ...`
- **Куда сохранить** — каталог проекта, `~/.config/proxitor/` или `$XDG_CONFIG_HOME/proxitor/`

После получения ключа, базового URL и типа аутентификации мастер выполняет **пробу апстрима по возможности** (таймаут 3 с), чтобы проверить связность. Если апстрим недоступен или ключ отклонён, выводится предупреждение, но конфиг всё равно сохраняется — это только информация.

Если конфиг уже существует, мастер показывает его расположение и спрашивает, перенастроить ли. Все поля **предзаполнены** текущими значениями — жмите Enter, чтобы оставить, или вводите новое. Существующие `modelOverrides`, `provider` и прочие поля сохраняются — обновляются только поля мастера.

### Меню и команды конфигурации

`proxitor config` (или `proxitor config menu`) открывает интерактивное меню, которое крутится до выхода. Оттуда можно управлять всеми настройками:

- **Показать текущий конфиг** — вывести резолвнутую конфигурацию
- **API-ключ и подключение** — поменять ключ, порт, адрес, базовый URL, тип аутентификации
- **Caching** — три рычага кэширования на одном экране: `cacheControl` (+TTL), `sessionId`, `normalizeVolatileSystem`
- **Переопределения моделей** — добавлять, редактировать, удалять, смотреть, листать модели (у каждого переопределения своё подменю **💾 Caching**)

```sh
proxitor config menu           # интерактивное меню
proxitor config add            # добавить переопределение модели
proxitor config edit           # редактировать существующее
proxitor config remove         # удалить переопределение(я)
proxitor config list           # показать текущие переопределения
proxitor config list --json    # переопределения в JSON
proxitor config show           # вывести резолвнутый конфиг (слитый)
proxitor config show --json    # то же, машиночитаемо
proxitor config browse         # изучать модели с ценами
proxitor config wizard         # мастер настройки
proxitor config validate       # проверить файл конфига (exit 0 ок, 1 невалиден)
proxitor config validate --json  # структурированный JSON-результат
proxitor doctor                # диагностика окружения + сети + порта + версии
proxitor doctor --json         # машиночитаемый диагностический отчёт
proxitor doctor --offline      # пропустить сетевые проверки
```

При добавлении или редактировании переопределения модели можно также настроить per-model `sessionId` и `cacheControl` — полезно для моделей, которым нужно поведение по кэшу/маршрутизации, отличное от глобального.

В `config edit` любое поле (провайдер, session ID, cache control, cache TTL) можно сбросить к наследованию глобального/значения по умолчанию через опцию **Reset / inherit**. Глобальные команды `config cache-control` и `config session-routing` поддерживают тот же сброс — поле возвращается к значению схемы по умолчанию.

### Разбор добавления переопределения

```sh
$ proxitor config add

┌──────────────────────────────────┐
│   Add Model Override             │
╰──────────────────────────────────╯

◇ Search for a model
│ claude
  (23 matches)
  ● anthropic/claude-sonnet-4-6 · $3.00/$15.00 · 200k
  ○ anthropic/claude-opus-4-8   · $15.00/$75.00 · 200k
  ...

◇ Configure provider routing
│ ○ Use specific providers only
  ○ Set provider priority order
  ○ Ignore specific providers
  ○ Skip provider routing
```

**«Use specific providers only» / «Ignore specific providers»** — множественный выбор, отмечаете нужные:

```text
◇ Select providers
  ◼ anthropic (anthropic)     · 1.0s · 40 t/s
  ◻ google-vertex/global      · 1.1s · 39 t/s
  ◻ amazon-bedrock            · 1.2s · 40 t/s
```

**«Set provider priority order»** — выбираете провайдеров по одному, затем жмёте **✓ Done** внизу для завершения:

```text
◇ Select provider #1 (or cancel to finish)
│ ● anthropic (anthropic)     · 1.0s · 40 t/s
  ○ google-vertex/global      · 1.1s · 39 t/s
  ○ amazon-bedrock            · 1.2s · 40 t/s
  ○ ✓ Done

◇ Select provider #2 (or cancel to finish)
│ ● google-vertex/global      · 1.1s · 39 t/s
  ○ amazon-bedrock            · 1.2s · 40 t/s
  ○ ✓ Done

◇ Select provider #3 (or cancel to finish)
│ ● ✓ Done

◇ Allow fallbacks to other providers? Yes

◇ Save to config? Yes

╭──────────────────────────────────╮
│ ✓ Model override saved           │
╰──────────────────────────────────╯
```

Интерфейс использует живые данные OpenRouter API — поиск моделей с type-ahead, реальная доступность провайдеров и цены для каждой модели.

## Диагностика

Когда что-то не работает, `proxitor doctor` прогоняет батарею проверок и печатает отчёт. Разделы:

- **Окружение** — версия Node, платформа, TTY
- **Конфиг** — путь обнаружения, валидность, число переопределений
- **API-ключ** — источник (env или файл; сам ключ не печатается)
- **Сеть** — достижимость апстрима (с настраиваемым таймаутом)
- **Порт** — доступность настроенного порта
- **Версия** — установленная версия

Статусы: `✓ ok` / `⚠ warn` / `✗ fail` / `ⓘ skip`. Код выхода `0`, если нет `fail`, иначе `1` — можно дёргать из CI.

```sh
$ proxitor doctor

▲ Proxitor Doctor
│
◇ Environment
│  ✓ node-version — v22.4.1
│  ✓ platform — darwin arm64
│  ✓ tty — true
│
◇ Config
│  ✓ config-found — /Users/u/proj/proxitor.config.yaml
│  ✓ config-valid — 12 keys, 3 override(s)
│
◇ API key
│  ✓ api-key — set (env: set, file: set)
│
◇ Network
│  ✓ upstream — https://openrouter.ai/api — 200, 342 models
│
◇ Port
│  ✓ port-8828 — 127.0.0.1:8828
│
◇ Version
│  ✓ version — 0.9.0-beta.5

└ Done. All checks passed.
```

Полезные флаги:

```sh
proxitor doctor --json         # структурированный JSON для CI/скриптов
proxitor doctor --offline      # пропустить сетевые проверки (без апстрима и npm)
proxitor doctor --timeout 5000 # свой сетевой таймаут на проверку (мс)
```

## Опции CLI

```sh
proxitor                        # запустить прокси (команда по умолчанию)
proxitor start                  # то же самое
proxitor up                     # алиас для start
proxitor run                    # алиас для start
proxitor --port 9000            # переопределить порт
proxitor --config ./team.yaml   # явно указать конфиг
proxitor config show            # вывести резолвнутый конфиг
proxitor config show --json     # машиночитаемый конфиг
proxitor config list --json     # переопределения в JSON
proxitor config wizard          # мастер настройки
proxitor config validate        # проверить текущий конфиг (exit 0/1)
proxitor config validate --json # структурированный JSON-результат
proxitor doctor                 # диагностика окружения, сети, порта, версии
proxitor doctor --offline       # пропустить сетевые проверки
proxitor --help                 # полная справка
proxitor --version              # напечатать версию
```

| Флаг | По умолчанию | Описание |
|---|---|---|
| `-p, --port <порт>` | `8828` | Порт сервера (валидация: 1-65535) |
| `--host <хост>` | `0.0.0.0` | Хост сервера |
| `-c, --config <путь>` | автообнаружение | Путь к файлу конфига |
| `--openrouter-key <ключ>` / `-k <ключ>` | `$OPENROUTER_API_KEY` | API-ключ OpenRouter |
| `--verbose` | `false` | Подробное логирование |
| `--no-config` | | Пропустить обнаружение файла конфига |
| `-v, --version` | | Напечатать версию |
| `--help` | | Напечатать справку |

Подкоманды живут под `proxitor config <подкоманда>`. Полный список — `proxitor config --help`.

---

← [Назад к README](./README.ru.md)
