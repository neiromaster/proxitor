# proxitor

<p align="center">
  <strong>Мультипровайдерный шлюз LLM с конвейером плагинов.</strong><br/>
  Anthropic Messages и OpenAI Chat на входе — любой провайдер на выходе.<br/>
  Один YAML-файл с горячей перезагрузкой.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/proxitor"><img src="https://img.shields.io/npm/v/proxitor?color=6366f1&labelColor=1e2327&label=npm" alt="npm version"></a>
  <a href="https://github.com/neiromaster/proxitor/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/neiromaster/proxitor/ci.yml?branch=main&color=22c55e&labelColor=1e2327&label=CI" alt="CI status"></a>
  <a href="../LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e?labelColor=1e2327" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-3b82f6?labelColor=1e2327" alt="Node.js ≥ 22">
  <a href="https://github.com/neiromaster/proxitor/issues"><img src="https://img.shields.io/github/issues/neiromaster/proxitor?color=f59e0b&labelColor=1e2327&label=issues" alt="GitHub issues"></a>
</p>

🌍 [English](../README.md) · **Русский**

---

## Зачем proxitor

- **Настройте Claude Code (или любой Anthropic/OpenAI-клиент) на одну локальную точку входа** — маршрутизируйте каждую модель на любой провайдер
- **Трансляция форматов через Canonical IR** — `anthropic‑messages` ⇄ `openai‑chat`, стриминг сквозной
- **Конвейер плагинов для каждого запроса/ответа** — встроенные: `normalize‑volatile‑system`, `cache‑control`, `session‑id`, `openrouter‑routing`; пишите свои через `@proxitor/plugin-api`
- **Наблюдаемость кэша подсказок** — `HIT`/`PARTIAL`/`MISS`/`COLD` по запросам, трекинг сессий, дампы тел
- **Горячая перезагрузка с keep‑last‑valid** — ошибочные правки откатываются до последнего валидного конфига; токен-гейт на управляющую плоскость; плавное завершение с дрейном

## Как это работает

```text
Клиент Claude Code
       │
       ▼
┌─────────────────────────────────────────────┐
│  proxitor (сервер Hono)                     │
│  ┌─────────────────────────────────────┐   │
│  │ 1. Декодирование входящего (anthropic- │   │
│  │    messages или openai-chat) → Canonical IR │   │
│  │                                     │   │
│  │ 2. Конвейер плагинов (3 слоя)       │   │
│  │    глобальный → провайдер → модель    │   │
│  │                                     │   │
│  │ 3. Таблица маршрутизации моделей     │   │
│  │    (glob-паттерн, $MODEL passthrough)│   │
│  │                                     │   │
│  │ 4. Кодирование исходящего           │   │
│  │    (формат провайдера)              │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  Тап наблюдаемости (строки кэша, дампы)      │
│  Вотчер горячей перезагрузки (запись конфига)│
│  Управляющая плоскость (/control/* с токеном) │
└─────────────────────────────────────────────┘
       │
       ▼
  провайдер (OpenAI / Anthropic / GLM / …)
```

Запросы и стриминговые ответы проходят тот же конвейер в обратном направлении.

## Установка

Требуется **Node.js 22+**.

```sh
npm install -g proxitor
# или:  pnpm install -g proxitor
# или:  npx proxitor@latest
```

## Быстрый старт

**1. Сгенерируйте минимальный конфиг**

```sh
proxitor config wizard
```

**2. Запустите шлюз**

```sh
proxitor start
# → proxitor слушает на http://127.0.0.1:8828
```

**3. Настройте клиент на него**

```sh
# Claude Code
ANTHROPIC_BASE_URL=http://127.0.0.1:8828 ANTHROPIC_API_KEY=sk-… claude

# Codex (OpenAI-совместимый)
OPENAI_BASE_URL=http://127.0.0.1:8828 OPENAI_API_KEY=sk-… codex
```

**4. Проверьте настройку**

```sh
proxitor doctor
```

## Команды

| Команда | Описание |
| --- | --- |
| `proxitor start` | Запустить шлюз |
| `proxitor config wizard` | Интерактивный генератор конфигурации |
| `proxitor doctor` | Диагностика окружения и конфигурации |

**Флаги `proxitor start`:**

| Флаг | По умолчанию | Описание |
| --- | --- | --- |
| `--config <путь>` | XDG search | Путь к конфигу |
| `--host <хост>` | config `server.host` | Адрес прослушивания |
| `--port <порт>` | config `server.port` | Порт прослушивания |
| `--verbose` | `false` | Подробное логирование |

**Флаги `proxitor doctor`:**

| Флаг | Описание |
| --- | --- |
| `--config <путь>` | Путь к конфигу (по умолчанию: XDG search) |
| `--json` | Машиночитаемый вывод JSON |

## Конфигурация

Минимальный пример (полная справка в [`docs/configuration.ru.md`](./configuration.ru.md)):

```yaml
version: 1

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

models:
  - match: 'claude-*'
    provider: anthropic
    modelId: '$MODEL'
  - match: '*'
    provider: openai
    modelId: '$MODEL'

defaultProvider: openai

server:
  host: 127.0.0.1
  port: 8828
```

Порядок обнаружения конфига:

```
1. --config <путь>                    # флаг CLI
2. ~/proxitor.config.{yaml,yml,json}   # HOME перекрывает XDG
3. ~/.proxitor.{yaml,yml,json}
4. $XDG_CONFIG_HOME/proxitor/config.{yaml,yml,json}  # по умолчанию ~/.config/proxitor/…
```

> **Предупреждение:** Конфиг в `~/` перекрывает `$XDG_CONFIG_HOME`. Мастер настройки предупреждает об этом.

## Конвейер плагинов

Три слоя плагинов (глобальный → провайдер → модель). Плагины выполняются в порядке объявления; каждый слой может отключить записи внешних слоёв.

**Встроенные плагины:**

| Плагин | Что делает | Опции |
| --- | --- | --- |
| `normalize-volatile-system` | Убирает хэши `cch=` и `cc_version=` из системных промптов Claude Code (стабилизирует префиксный кэш на не‑Anthropic провайдерах) | — |
| `cache-control` | Внедряет/переписывает `cache_control` с нормализацией TTL | `cacheControl` (auto/always/skip), `ttl` (5m/1h/omit), `rewriteBlockTtl` (auto/skip) |
| `session-id` | Липкая маршрутизация через заголовок `x-session-id` | `mode` (auto/skip) |
| `openrouter-routing` | Хинты маршрутизации провайдеров для `openai-chat` → OpenRouter (пишет `extensions['openai-chat']['$proxitor.provider']`) | [Опции маршрутизации OpenRouter](./configuration.ru.md#openrouter-routing) |

Пишите свои плагины через [`@proxitor/plugin-api`](https://www.npmjs.com/package/@proxitor/plugin-api).

**Маршрутизация моделей:** Glob-паттерны (`*`), passthrough `$MODEL`, первое совпадение выигрывает. Пример:

```yaml
models:
  - match: 'claude-*'      # префикс glob
    provider: glm
    modelId: '$MODEL'    # передаётся без изменений
  - match: '*'            # catch-all
    provider: openai
    modelId: '$MODEL'    # передаётся без изменений
```

## Эксплуатация

**Горячая перезагрузка:** Запись конфига → `POST /control/reload` (или автоматический вотчер; keep-last-valid при ошибке парсинга)

**Управляющая плоскость** (требует `controlPlane.token`):

- `GET /control/routing` — дамп текущей таблицы маршрутизации моделей
- `POST /control/reload` — перезагрузить конфиг с диска

**Наблюдаемость:** Каждый запрос логирует строку кэша (`HIT`/`PARTIAL`/`MISS`/`COLD`/`NOUSAGE` с % попадания). Установите `PROXITOR_DUMP_BODY=1` для записи парных дампов запроса/ответа в `~/.cache/proxitor/dumps`.

**Плавное завершение:** `SIGINT`/`SIGTERM` → drain (закрыть idle-соединения) → выход. Нажмите дважды для принуждения.

## Миграция с 0.20.x

**Breaking:** Формат конфига полностью заменён. Старые `provider.order`, `presets`, `openrouterKey`, `attributionReferer`, `normalizeResponses`, `modelOverrides` и семантика `cacheControl` **не** в v1.

**Что делать:**

1. **Запустите мастер** — `proxitor config wizard` генерирует v1-конфиг
2. **Обновите URL клиентов** — `ANTHROPIC_BASE_URL` или `OPENAI_BASE_URL` теперь указывают на шлюз v1
3. **`/v1/responses`** — возвращает `501 Not Implemented` в v1 (эндпоинт удалён)

## Участие

PR приветствуются — см. **[CONTRIBUTING.md](../CONTRIBUTING.md)** для настройки, тестов, коммитов и changeset'ов.

## Лицензия

[MIT](../LICENSE)
