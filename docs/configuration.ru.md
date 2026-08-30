# Справочник по конфигурации

🌍 [English](./configuration.md) · **Русский**

Полная справка по ручной настройке proxitor v1. Каждое поле получено из [`packages/proxy-core/src/application/config-schema.ts`](../packages/proxy-core/src/application/config-schema.ts).

Полный пример с комментариями — в файле [`proxitor.config.example.yaml`](../proxitor.config.example.yaml).

## Расположение конфига

Proxitor ищет конфиг в таком порядке:

```
1. --config <путь>                              # флаг CLI (явный путь)
2. ~/proxitor.config.{yaml,yml,json}           # HOME перекрывает XDG
3. ~/.proxitor.{yaml,yml,json}
4. $XDG_CONFIG_HOME/proxitor/config.{yaml,yml,json}   # по умолчанию ~/.config/proxitor/…
```

`XDG_CONFIG_HOME` по умолчанию — `~/.config` на Linux/macOS.

**Приоритет:** флаги CLI > файл конфига > переменные окружения > значения по умолчанию схемы.

> **HOME перекрывает XDG:** Если конфиг существует в `~/proxitor.config.yaml` или `~/.proxitor.yaml`, он **перекрывает** расположение XDG. Мастер настройки предупреждает об этом. Загружается только один файл конфига; первый найденный в порядке поиска выигрывает.

## Обзор схемы конфига

```yaml
version: 1                    # обязательно, литерал 1

providers:                    # обязательно, минимум один
  <provider-id>:             # ключ YAML становится id провайдера
    baseUrl: <string>
    wireFormat: <anthropic-messages | openai-chat>
    auth:
      type: <bearer | x-api-key | header | none>
      credential: <string | {env: <VAR>} | {file: <path>}>
      headerName: <string>   # обязательно когда type=header
    headers:                 # опционально, дополнительные заголовки провайдера
      <name>: <value>
    plugins:                 # опционально, список плагинов уровня провайдера
    unsupportedParams: <error | drop>
    maxTokensField: <auto | max_tokens | max_completion_tokens>

models:                       # обязательно, минимум одна привязка
  - match: <glob>
    provider: <provider-id>
    modelId: <string | $MODEL>
    plugins:                 # опционально, список плагинов уровня модели

defaultProvider: <provider-id>   # опционально, обслуживает запросы без модели

plugins:                      # опционально, глобальный список плагинов

server:                       # опционально, значения по умолчанию показаны
  host: 127.0.0.1
  port: 8828
  bodyLimit: 50mb
  forwardHeaders: []         # опционально, имена заголовков для проброса от входящего запроса

controlPlane:                 # опционально
  token: <string | {env: <VAR>} | {file: <path}>

observability:                # опционально, значения по умолчанию показаны
  routerMetadata: true
  hitThreshold: 80
  sideMaxTokens: 4096
  sessionMaxEntries: 4096
  sessionTtlMs: 600000

logging:                      # опционально
  verbose: false
```

## Поля верхнего уровня

### `version`

**Обязательно.** Литерал `1` — версия схемы конфига.

```yaml
version: 1
```

Источник: [`config-schema.ts:159`](../packages/proxy-core/src/application/config-schema.ts#L159)

### `providers`

**Обязательно.** Карта конфигураций провайдеров. Ключ YAML **становится** id провайдера (ссылается в `models[].provider` и `defaultProvider`).

Нужно объявить минимум один провайдер.

**Поля провайдера:**

| Поле | Тип | По умолчанию | Описание |
| --- | --- | --- | --- |
| `baseUrl` | string (min 1) | — | Базовый URL провайдера (напр. `https://api.openai.com`) |
| `wireFormat` | enum | — | `anthropic-messages` или `openai-chat` |
| `auth.type` | enum | — | `bearer`, `x-api-key`, `header`, `none` |
| `auth.credential` | string или `{env: VAR}` или `{file: path}` | — | API-ключ или ссылка на креденшиал |
| `auth.headerName` | string (min 1) | — | Имя заголовка (обязательно когда `type: header`) |
| `headers` | `{[key: string]: string}` | — | Дополнительные заголовки для этого провайдера (опционально) |
| `plugins` | список плагинов | — | Плагины уровня провайдера (опционально) |
| `unsupportedParams` | `error` \| `drop` | — | Как обрабатывать неподдерживаемые параметры запроса (опционально) |
| `maxTokensField` | `auto` \| `max_tokens` \| `max_completion_tokens` | — | Какое поле использовать для max tokens (опционально) |

**Пример:**

```yaml
providers:
  openai:
    baseUrl: https://api.openai.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: { env: OPENAI_API_KEY } }
  anthropic:
    baseUrl: https://api.anthropic.com
    wireFormat: anthropic-messages
    auth: { type: x-api-key, credential: { env: ANTHROPIC_API_KEY } }
    headers: { anthropic-version: '2023-06-01' }
```

**Резолвинг креденшиалов:**

- `credential: "sk-..."` — строка-литерал (только для тестирования; **не рекомендуется** для продакшена)
- `credential: { env: "VAR_NAME" }` — читать из переменной окружения (`process.env.VAR_NAME`)
- `credential: { file: "/path/to/file" }` — читать из файла (загрузка при рантайме; горячая перезагрузка перезапускается если файл меняется)

**Предупреждение:** Изменение креденшиала на основе `env:` требует перезапуска proxitor — вотчер перезагружается только при записи файла конфига, не при изменениях env vars.

Источник: [`config-schema.ts:18-56`](../packages/proxy-core/src/application/config-schema.ts#L18-L56)

### `models`

**Обязательно.** Массив привязок моделей. Нужно объявить минимум одну привязку.

**Поля привязки:**

| Поле | Тип | Описание |
| --- | --- | --- |
| `match` | string (min 1) | Glob-паттерн для матчинга логических имён моделей (напр. `claude-*`, `*`) |
| `provider` | string (min 1) | ID провайдера (должен существовать в `providers`) |
| `modelId` | string (min 1) | Идентификатор модели для исходящего запроса; `$MODEL` передаёт логическое имя без изменений |
| `plugins` | список плагинов | Плагины уровня модели (опционально) |

**Первое совпадение выигрывает.** Паттерны — glob'ы; `*` матчит любую последовательность. Используйте `$MODEL` для передачи имени модели от клиента без изменений (обычно когда провайдер использует те же имена).

**Пример:**

```yaml
models:
  - match: 'claude-*'          # префикс glob
    provider: glm
    modelId: '$MODEL'        # передаётся без изменений
  - match: '*'                # catch-all
    provider: openai
    modelId: '$MODEL'        # передаётся без изменений
```

Когда клиент запрашивает `claude-sonnet-4-6`:
1. `claude-*` матчится → `provider: glm`, `modelId` становится `claude-claude-sonnet-4-6`
2. Тот провайдер/модель используется для запроса

Источник: [`config-schema.ts:58-67`](../packages/proxy-core/src/application/config-schema.ts#L58-L67)

### `defaultProvider`

**Опционально.** ID провайдера (должен существовать в `providers`). Обслуживает запросы без модели:

- Вызовы embeddings API (нет модели в payload)
- Листинг `/v1/models`

Если опущено, запросы без модели падают с `404`.

**Пример:**

```yaml
defaultProvider: openai
```

Источник: [`config-schema.ts:163`](../packages/proxy-core/src/application/config-schema.ts#L163)

### `plugins`

**Опционально.** Глобальный список плагинов. Плагины выполняются в порядке объявления на каждом запросе.

Каждая запись либо:

- Строка (имя плагина, напр. `cache-control`)
- Объект `{name: <plugin>, options: {...}}` для опций плагина

**Пример:**

```yaml
plugins:
  - normalize-volatile-system
  - cache-control:
      cacheControl: auto
      ttl: 1h
      rewriteBlockTtl: auto
  - session-id
```

**Слои плагинов (порядок мёржа):** глобальный → провайдер → модель. Внутренние слои могут отключать плагины внешних слоёв через список `disable` (см. ниже).

**Встроенные плагины:**

| Имя плагина | Опции |
| --- | --- |
| `normalize-volatile-system` | — (без опций) |
| `cache-control` | `cacheControl` (auto/always/skip), `ttl` (5m/1h/omit), `rewriteBlockTtl` (auto/skip) |
| `session-id` | `mode` (auto/skip) |
| `openrouter-routing` | [Опции маршрутизации OpenRouter](#openrouter-routing) |

Источник: [`config-schema.ts:24-26`](../packages/proxy-core/src/application/config-schema.ts#L24-L26)

### `server`

**Опционально.** Конфигурация сервера.

| Поле | Тип | По умолчанию | Описание |
| --- | --- | --- | --- |
| `host` | string (min 1) | `127.0.0.1` | Адрес прослушивания |
| `port` | number (1‑65535) | `8828` | Порт прослушивания |
| `bodyLimit` | string или number | `50mb` | Макс. размер тела запроса (напр. `10mb`, `50mb`, `1gb`) |
| `forwardHeaders` | `string[]` | `[]` | Имена заголовков для проброса от входящего запроса к провайдеру |

**Форматы `bodyLimit`:** `"50mb"` (строка) или `52428800` (число байтов). Единицы: `b`, `kb`, `mb`, `gb` (регистронезависимо).

**Пример:**

```yaml
server:
  host: 0.0.0.0        # все интерфейсы
  port: 9000
  bodyLimit: 100mb
  forwardHeaders:
    - x-custom-api-key
    - x-request-id
```

Источник: [`config-schema.ts:110-125`](../packages/proxy-core/src/application/config-schema.ts#L110-L125)

### `controlPlane`

**Опционально.** Аутентификация управляющей плоскости.

| Поле | Тип | Описание |
| --- | --- | --- |
| `token` | string или `{env: VAR}` или `{file: path}` | Токен для эндпоинтов `/control/*` |

Если опущено, эндпоинты `/control/*` возвращают `404` (неразличимо от отсутствующего маршрута).

**Пример:**

```yaml
controlPlane:
  token: { env: PROXITOR_CONTROL_TOKEN }
```

Использование:

```bash
# Экспортируйте токен
export PROXITOR_CONTROL_TOKEN=secret-token

# Обратитесь к управляющей плоскости
curl -H "Authorization: Bearer secret-token" http://127.0.0.1:8828/control/routing
```

Источник: [`config-schema.ts:146-149`](../packages/proxy-core/src/application/config-schema.ts#L146-L149)

### `observability`

**Опционально.** Наблюдаемость и трекинг кэша.

| Поле | Тип | По умолчанию | Описание |
| --- | --- | --- | --- |
| `routerMetadata` | boolean | `true` | Отправлять заголовок `x-openrouter-metadata` для захвата маршрутизации провайдера (где доступно) |
| `hitThreshold` | number (0‑100) | `80` | Чтение кэша / входные токены % ≥ этого → `HIT` (иначе `PARTIAL`) |
| `sideMaxTokens` | number (positive) | `4096` | Запрос без инструментов И `max_tokens` ≤ этого → классификация `[side]` |
| `sessionMaxEntries` | number (positive) | `4096` | Ёмкость ограниченного LRU для трекера сессий (FIFO eviction) |
| `sessionTtlMs` | number (positive) | `600000` | TTL записи трекера сессий (10 минут) |

**Метки исхода кэша:**

| Метка | Значение |
| --- | --- |
| `HIT` | Чтение кэша ≥ `hitThreshold`% от входных токенов |
| `PARTIAL` | Частичное чтение кэша, но ниже порога |
| `MISS` | Нет чтения кэша на **повторном** запросе в той же сессии |
| `COLD` | Нет чтения кэша на **первом** запросе в сессии |
| `NOUSAGE` | Объект usage не наблюдался (неправильный ответ и т.п.) |

**Тип запроса:** Каждый запрос логируется как `[main]` или `[side]`. `[side]` = нет инструментов И `max_tokens ≤ sideMaxTokens`.

**Пример:**

```yaml
observability:
  routerMetadata: true
  hitThreshold: 80
  sideMaxTokens: 4096
  sessionMaxEntries: 4096
  sessionTtlMs: 600000
```

**Вывод в консоль (по запросу):**

```
[a1b2] HIT   99%  read 48640  in 48874  glm-4.5-air  [main]
[c3d4] PARTIAL  42%  read 1088  in 2600  provider=anthropic  claude-sonnet-4-6  [side]
```

**Дампы тел:** Установите `PROXITOR_DUMP_BODY=1` для записи парных дампов запроса/ответа в `~/.cache/proxitor/dumps`. Каждый дамп обогащён `label`, `hitPct`, `provider` и т.д.

Источник: [`config-schema.ts:127-144`](../packages/proxy-core/src/application/config-schema.ts#L127-L144)

### `logging`

**Опционально.** Конфигурация логирования.

| Поле | Тип | По умолчанию | Описание |
| --- | --- | --- | --- |
| `verbose` | boolean | `false` | Подробное логирование |

**Пример:**

```yaml
logging:
  verbose: true
```

Источник: [`config-schema.ts:151-156`](../packages/proxy-core/src/application/config-schema.ts#L151-L156)

## Слои плагинов и семантика отключения

Плагины выполняются в трёх слоях:

1. **Глобальный** (`plugins` верхнего уровня) — выполняется на каждом запросе
2. **Провайдер** (`providers.<id>.plugins`) — выполняется только для этого провайдера
3. **Модель** (`models[].plugins`) — выполняется только для этой модели

**Порядок мёржа:** глобальный → провайдер → модель (внутренние слои дополняют внешние).

**Отключение:** Любой слой может отключить специфичные плагины внешних слоёв:

```yaml
plugins:
  - cache-control
  - session-id

providers:
  openai:
    plugins:
      - disable: [cache-control]   # отключить глобальный cache-control для OpenAI

models:
  - match: 'claude-*'
    provider: anthropic
    modelId: '$MODEL'
    plugins:
      - disable: [session-id]      # отключить глобальный session-id для моделей Claude
```

Используйте это для opt-out из глобальных настроек для специфичных маршрутов.

## Встроенные плагины

### `normalize-volatile-system`

Убирает волатильные хэши Claude Code из системных промптов:

- `cch=<hex>` (хеш за ход) → константа `cch=00000`
- `cc_version=<semver>.<hex>` → `cc_version=<semver>.0`

Эти хэши дрейфуют каждый ход и ломают префиксное кэширование для не‑Anthropic провайдеров (GLM, Qwen и т.д.). Нормализация стабилизирует кэшируемый префикс.

**Без опций.**

```yaml
plugins:
  - normalize-volatile-system
```

Источник: [`plugins/built-in/normalize-volatile-system.ts`](../packages/proxy-core/src/plugins/built-in/normalize-volatile-system.ts)

### `cache-control`

Внедряет и переписывает `cache_control` breakpoints с нормализацией TTL.

**Опции:**

| Опция | Тип | По умолчанию | Описание |
| --- | --- | --- | --- |
| `cacheControl` | `auto` \| `always` \| `skip` | `auto` | Режим внедрения |
| `ttl` | `5m` \| `1h` \| `omit` | — | TTL кэша (опционально) |
| `rewriteBlockTtl` | `auto` \| `skip` | `auto` | Нормализовать block-level TTL до соответствия `ttl` |

**Режимы `cacheControl`:**

| Режим | Поведение |
| --- | --- |
| `auto` | Внедрять только когда запрос уже имеет cache breakpoints (безопасный дефолт для Anthropic-нативных) |
| `always` | Всегда внедрять cache breakpoints |
| `skip` | Passthrough — не внедрять |

**Значения `ttl`:**

| Значение | TTL | Использовать когда |
| --- | --- | --- |
| `5m` | 5 минут (дефолт Anthropic) | Частые запросы (>1 за 5 мин) |
| `1h` | 1 час | Редкие или длинные сессии |
| `omit` | Убрать поле `ttl` | Принудительно отключить TTL |

**Режимы `rewriteBlockTtl`:**

| Режим | Поведение |
| --- | --- |
| `auto` | Переписывать существующие block TTLs до `ttl` на Anthropic-нативных эндпоинтах |
| `skip` | Оставить block TTLs нетронутыми |

**Зачем `rewriteBlockTtl`?** Claude Code отправляет block-level `cache_control` без `ttl` (Anthropic трактует их как `5m`). Если вы установили `ttl: 1h`, запрос уходит со смешанными `1h` root / `5m` blocks → Anthropic отвергает его. `rewriteBlockTtl: auto` нормализует blocks до `1h`.

**Пример:**

```yaml
plugins:
  - cache-control:
      cacheControl: auto
      ttl: 1h
      rewriteBlockTtl: auto
```

Источник: [`plugins/built-in/cache-control.ts`](../packages/proxy-core/src/plugins/built-in/cache-control.ts)

### `session-id`

Липкая маршрутизация через заголовок `x-session-id`. Использует session id клиента (заголовки `x-claude-code-session-id` / `x-session-id`), если он отправлен; иначе выводит стабильный ID сессии из логической модели, системного промпта и первого сообщения пользователя.

**Опции:**

| Опция | Тип | По умолчанию | Описание |
| --- | --- | --- | --- |
| `mode` | `auto` \| `skip` | `auto` | Режим session ID |

**Значения `mode`:**

| Режим | Поведение |
| --- | --- |
| `auto` | Использовать session id клиента (заголовки `x-claude-code-session-id` / `x-session-id`), если отправлен; иначе вывести стабильный ID из модели + системного промпта + первого сообщения пользователя |
| `skip` | Passthrough — не генерировать |

**Пример:**

```yaml
plugins:
  - session-id:
      mode: auto
```

Источник: [`plugins/built-in/session-id.ts`](../packages/proxy-core/src/plugins/built-in/session-id.ts)

### `openrouter-routing`

Хинты маршрутизации провайдеров для формата `openai-chat` OpenRouter. Пишет `extensions['openai-chat']['$proxitor.provider']` с опциями маршрутизации; энкодер мапит это на тело запроса.

**Опции (все опционально):**

| Опция | Тип | Описание |
| --- | --- | --- |
| `only` | string или `string[]` | Разрешить только этих провайдеров |
| `order` | string или `string[]` | Пробовать провайдеров в этом приоритетном порядке |
| `ignore` | string или `string[]` | Никогда не использовать этих провайдеров |
| `allowFallbacks` | boolean | Разрешить фолбэки вне `order` (дефолт `true` когда установлен `order`) |
| `sort` | `"price"` \| `"throughput"` \| `"latency"` \| `{by, partition?}` | Сортировать провайдеров по метрике |
| `quantizations` | `string[]` | Фильтр по уровню квантизации (напр. `["fp8"]`) |
| `maxPrice` | `{prompt?, completion?, request?, image?}` | Макс. цена ($/M токенов) |
| `requireParameters` | boolean | Только провайдеры поддерживающие все параметры запроса |
| `dataCollection` | `"allow"` \| `"deny"` | Политика сбора данных |
| `zdr` | boolean | Принудительное Zero Data Retention |
| `enforceDistillableText` | boolean | Принудить флаг distillable‑text |
| `preferredMinThroughput` | number или `{p50?, p75?, p90?, p99?}` | Мягкий минимальный порог throughput |
| `preferredMaxLatency` | number или `{p50?, p75?, p90?, p99?}` | Мягкий максимальный порог латентности |

**Пример:**

```yaml
plugins:
  - openrouter-routing:
      only: anthropic
      maxPrice: { prompt: 1, completion: 2 }
      dataCollection: deny
```

**Примечание:** Этот плагин гейтится для `openai-chat` маршрутов через зарезервированные ключи; он не влияет на `anthropic-messages` запросы.

Источник: [`plugins/built-in/openrouter-routing.ts`](../packages/proxy-core/src/plugins/built-in/openrouter-routing.ts)

## Переменные окружения

| Переменная | Назначение |
| --- | --- |
| `PROXITOR_DUMP_BODY=1` | Записывать дампы запроса/ответа в `~/.cache/proxitor/dumps` |
| `PROXITOR_CONTROL_TOKEN` | Токен управляющей плоскости (когда `controlPlane.token` использует `{env: PROXITOR_CONTROL_TOKEN}`) |
| `PROXITOR_DUMP_DIR` | Переопределить директорию дампов (дефолт `~/.cache/proxitor/dumps`) |
| `XDG_CONFIG_HOME` | Переопределить директорию пользовательского конфига (дефолт `~/.config`) |

**Env vars для креденшиалов** (ссылаются в `auth.credential.{env: ...}`): используйте любое имя переменной (напр. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`). Proxitor читает их при старте; изменения требуют перезапуска.

## Полный аннотированный пример

```yaml
# конфигурация proxitor v1 — скопируйте в ~/.config/proxitor/config.yaml
# или передайте --config <path>.

version: 1

# Глобальные плагины (выполняются на каждом запросе)
plugins:
  - normalize-volatile-system
  - cache-control:
      cacheControl: auto
      ttl: 1h
      rewriteBlockTtl: auto
  - session-id

# Конфигурации провайдеров (ключ YAML = id провайдера)
providers:
  openai:
    baseUrl: https://api.openai.com
    wireFormat: openai-chat
    auth:
      type: bearer
      credential: { env: OPENAI_API_KEY }   # читается из process.env.OPENAI_API_KEY
    # Опционально: дополнительные заголовки для этого провайдера
    # headers:
    #   x-custom: value

  anthropic:
    baseUrl: https://api.anthropic.com
    wireFormat: anthropic-messages
    auth:
      type: x-api-key
      credential: { env: ANTHROPIC_API_KEY }
    headers: { anthropic-version: '2023-06-01' }

  glm:
    baseUrl: https://api.example.com
    wireFormat: openai-chat
    auth:
      type: bearer
      credential: { env: GLM_API_KEY }
    # Плагины уровня провайдера (дополняют глобальные, могут отключать глобальные)
    plugins:
      - disable: [cache-control]   # отключить cache-control для GLM

# Таблица маршрутизации моделей (первое совпадение выигрывает)
models:
  # Glob-префикс — все claude-* модели идут на GLM
  - match: 'claude-*'
    provider: glm
    modelId: '$MODEL'           # передать логическое имя без изменений
    plugins:
      - disable: [session-id]  # отключить session-id для моделей Claude

  # Catch-all — всё остальное на OpenAI
  - match: '*'
    provider: openai
    modelId: '$MODEL'

# Провайдер по умолчанию для запросов без модели (embeddings, /v1/models)
defaultProvider: openai

# Конфигурация сервера
server:
  host: 127.0.0.1
  port: 8828
  bodyLimit: 50mb
  # Опционально: пробросить специфичные входящие заголовки к провайдерам
  # forwardHeaders:
  #   - x-custom-api-key

# Управляющая плоскость (требуется для эндпоинтов /control/*)
controlPlane:
  token: { env: PROXITOR_CONTROL_TOKEN }

# Наблюдаемость (трекинг кэша, классификация запросов)
observability:
  routerMetadata: true          # захватывать метаданные маршрутизации провайдера
  hitThreshold: 80             # чтение кэша ≥ 80% → HIT
  sideMaxTokens: 4096          # маленькие запросы → [side]
  sessionMaxEntries: 4096      # ёмкость трекера сессий
  sessionTtlMs: 600000         # TTL трекера сессий (10 минут)

# Логирование
logging:
  verbose: false
```

← [Назад к README](../README.md)
