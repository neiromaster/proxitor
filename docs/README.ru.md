# proxitor

<p align="center">
  <strong>Прозрачный прокси для AI CLI-инструментов.</strong><br/>
  Фиксируйте провайдеров. Держите кэш подсказок живым. Снижайте расходы.<br/>
  Ваши инструменты ничего не замечают.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/proxitor"><img src="https://img.shields.io/npm/v/proxitor?color=6366f1&labelColor=1e2327&label=npm" alt="npm version"></a>
  <a href="https://github.com/neiromaster/proxitor/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/neiromaster/proxitor/ci.yml?branch=main&color=22c55e&labelColor=1e2327&label=CI" alt="CI status"></a>
  <a href="../LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e?labelColor=1e2327" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-3b82f6?labelColor=1e2327" alt="Node.js ≥ 22">
  <a href="https://github.com/neiromaster/proxitor/issues"><img src="https://img.shields.io/github/issues/neiromaster/proxitor?color=f59e0b&labelColor=1e2327&label=issues" alt="GitHub issues"></a>
</p>

🌍 [English](../README.md) · **Русский**

<p align="center"><img src="./assets/proxitor-wizard.gif" alt="мастер настройки proxitor" width="640"></p>

---

## Содержание

- [Зачем proxitor](#зачем-proxitor)
- [Как это работает](#как-это-работает)
- [Проблема кэширования](#проблема-кэширования)
- [Возможности](#возможности)
- [Установка](#установка)
- [Быстрый старт](#быстрый-старт)
- [Минимальный конфиг](#минимальный-конфиг)
- [Конфигурация](#конфигурация)
- [Диагностика](#диагностика)
- [Команды](#команды)
- [Частые проблемы](#частые-проблемы)
- [Разработка](#разработка)
- [Лицензия](#лицензия)

## Зачем proxitor

AI CLI уже умеют говорить с Anthropic- или OpenAI-совместимыми API. proxitor сохраняет этот интерфейс и чинит дорогие места посередине:

- **Фиксация провайдера** не даёт OpenRouter перекидывать одну сессию между апстримами.
- **Подготовка prompt cache** добавляет липкие сессии, cache breakpoints, исправление TTL и нормализацию волатильного префикса там, где это нужно.
- **Маршрутизация по моделям** позволяет Claude, GPT, Qwen, GLM и другим семействам использовать разные провайдеры и политики.
- **Операционные проверки** (`doctor`, `/health`, валидация конфига, hot reload) делают прокси безопасным для долгих coding-сессий.

## Как это работает

```text
ваш AI-инструмент  →  proxitor  →  OpenRouter  →  выбранный вами провайдер
```

Proxitor встаёт между Claude Code, Codex или любым CLI, совместимым с Anthropic/OpenAI, и [OpenRouter](https://openrouter.ai). Один ключ — все модели, но **вы** решаете, какой провайдер обслуживает каждый запрос, и заставляете кэширование подсказок наконец-то работать.

## Проблема кэширования

OpenRouter балансирует нагрузку между провайдерами, а **кэш подсказок привязан к провайдеру**: кэш, собранный на Anthropic, не поможет, когда следующий запрос улетит на DeepInfra. Claude Code отправляет большой системный промпт в каждом запросе, поэтому без зафиксированного провайдера вы каждый раз платите по полной.

Закрепите `claude-*` за `anthropic` — и системный промпт закэшируется после первого попадания. Последующие запросы стоят крохи.

Типичный системный промпт Claude Code на 50k токенов при $3/M стоит **$0.15 за ход** без кэша. С прогретым Anthropic-кэшом тот же префикс стоит ~10% от цены входа — около **$0.015 за ход**. Кэш окупается за 1-2 хода и окупает себя до конца сессии.

## Возможности

- 🔒 **Стабильное кэширование** — фиксируйте модели за одним провайдером, чтобы кэш промптов сохранялся между запросами
- 💰 **Контроль расходов** — направляйте конкретные модели на более дешёвых провайдеров, когда кэширование не в приоритете
- 🔄 **Автоматические фолбэки** — Anthropic лёг? Переключитесь на DeepInfra, не трогая инструменты
- 🎯 **Смешанная маршрутизация** — `claude-*` на Anthropic, `gpt-*` на Azure, разные правила для разных моделей
- 🛡️ **Приватность** — принудительно включайте `dataCollection: deny` или zero-data-retention во всём
- 🔌 **Прозрачность** — ваши инструменты видят обычный API; на их стороне ничего не меняется

## Установка

Нужен **Node.js 22+**.

```sh
npm install -g proxitor
# или:  pnpm install -g proxitor
# или:  bun install -g proxitor
# или запустить без установки:  npx proxitor
```

## Быстрый старт

**1. Настройте** — мастер задаст несколько вопросов и сохранит конфиг:

```sh
proxitor config wizard
```

**2. Запустите**

```sh
proxitor                  # по умолчанию: http://0.0.0.0:8828
proxitor --port 9000      # или укажите свой порт
proxitor up               # алиасы: up, run
```

**3. Натравите на него инструмент**

```sh
# Claude Code
ANTHROPIC_BASE_URL=http://localhost:8828/v1 claude

# Codex
OPENAI_BASE_URL=http://localhost:8828/v1 codex
```

Это вся настройка. Запросы идут через proxitor; стримящиеся ответы проходят без изменений.

## Минимальный конфиг

Мастер пишет полный конфиг, но минимум — это API-ключ и одно правило маршрутизации. Положите это в `proxitor.config.yaml` (также принимаются `.yaml`/`.yml`/`.json`, либо `.proxitor.yaml`/`.proxitor.json` в корне проекта):

```yaml
openrouterKey: sk-or-v1-...   # или задайте OPENROUTER_API_KEY в окружении
provider:
  order: "anthropic"           # закрепляем всё за Anthropic для стабильного кэша
```

`proxitor config validate` — проверить, `proxitor` — запустить.

## Конфигурация

Удобный путь — интерактивное меню, без всякого YAML.

```sh
proxitor config         # открыть меню
proxitor config wizard  # (пере)запустить мастер настройки
proxitor config browse  # изучить модели + цены
```

В меню можно задать API-ключ и подключение, выбрать маршрутизацию по моделям (с живыми ценами провайдеров), настроить кэширование, добавлять и редактировать переопределения моделей. Меню тянет живые данные из OpenRouter, так что вы листаете реальные модели и провайдеров с актуальными ценами. Выбор модели — **нечёткий (fuzzy)**: наберите `claudops`, чтобы попасть на `anthropic/claude-opus`, или `gpt4o` для `openai/gpt-4o`; результаты ранжируются по релевантности, поэтому лучший вариант всплывает первым.

<p align="center"><img src="./assets/proxitor-add.gif" alt="proxitor: добавить переопределение модели" width="640"></p>

Предпочитаете править файл? Полный **[справочник по конфигурации](./configuration.ru.md)** покрывает маршрутизацию провайдеров, переопределения по моделям, заголовки, режимы кэширования и все опции. [`proxitor.config.example.yaml`](../proxitor.config.example.yaml) — шаблон с комментариями.

**Горячая перезагрузка** — proxitor следит за файлом конфига и подхватывает изменения на лету; перезапуск не нужен. Битые правки откатываются на последний валидный конфиг, и прокси продолжает работать. `proxitor config validate` покажет текущее состояние.

**Переменные окружения** — `OPENROUTER_API_KEY` используется, если ключ в конфиге пустой; `XDG_CONFIG_HOME` переопределяет каталог пользовательского конфига на Linux/macOS. Флаги CLI перекрывают оба.

## Диагностика

```sh
proxitor doctor   # проверяет окружение, конфиг, ключ, сеть, порт, версию
```

Он печатает понятный отчёт и выходит с ненулевым кодом, если что-то не так — удобно и из CI (`--json`, `--offline`, `--timeout`).

Пока proxitor работает, он печатает классифицированную строку кэша на каждый запрос — `HIT` / `PARTIAL` / `MISS` / `COLD` / `NOUSAGE`, процент попадания, провайдера, обслужившего запрос, и тип запроса (`[main]`/`[side]`) — чтобы сразу было видно, помогает ли кэширование на самом деле:

```text
[a1b2] HIT   99%  read 48640  in 48874  glm-4.5-air  [main]
```

Подробности — в **Конфигурация → [Наблюдаемость кэша](./configuration.ru.md#наблюдаемость-кэша)**: полный справочник по меткам, блок конфигурации `observability:` и обогащённые дампы.

Быстрая проверка здоровья: `curl http://localhost:8828/health`.

### Настройка кэша

Если попаданий в кэш маловато, четыре рычага это исправят — настройте их через `proxitor config` → **💾 Caching** (или `proxitor config cache`):

- **`cacheControl`** — внедряет `cache_control`, чтобы включить кэширование (нативно для Anthropic).
- **`sessionId`** — внедряет `session_id`, чтобы провайдер зафиксировался с первого запроса.
- **`normalizeVolatileSystem`** — убирает волатильные `cch`/`cc_version` хэши Claude Code, чтобы префиксный кэш прогревался на не-Anthropic провайдерах (qwen/glm/…).
- **`rewriteBlockTtl`** — приводит TTL блочных `cache_control`-брейкпойнтов Claude Code к вашему `cacheControlTtl`. Включите (`auto`/`always`), если Anthropic отклоняет запросы, где у корня `ttl: 1h`, а у блочных брейкпойнтов осталось `5m`.

Подробности — в [справочнике по конфигурации](./configuration.ru.md#кэширование-подсказок).

## Команды

| Команда | Описание |
| --- | --- |
| `proxitor` | Запустить прокси (команда по умолчанию) |
| `proxitor config` | Интерактивное меню настроек |
| `proxitor config wizard` | Мастер настройки |
| `proxitor config browse` | Изучить модели + цены |
| `proxitor config add` | Добавить переопределение модели |
| `proxitor config edit` | Редактировать переопределение модели |
| `proxitor config remove` | Удалить переопределение модели |
| `proxitor config list` | Список всех переопределений (также `--json`) |
| `proxitor config cache` | Настроить параметры кэширования |
| `proxitor config show` | Показать резолвленный конфиг |
| `proxitor config validate` | Проверить конфиг (exit 0 ok, 1 invalid — удобно для CI) |
| `proxitor doctor` | Продиагностировать всё |
| `proxitor --version` | Версия |
| `proxitor --help` | Полный список флагов |

Частые флаги: `--port`, `--host`, `--config <путь>`, `--openrouter-key <ключ>` / `-k <ключ>`, `--verbose`, `--no-config`.

## Частые проблемы

**Чтения из кэша остаются на 0 даже после нескольких запросов.** Обычно префикс меняется каждый ход (хэши `cch`/`cc_version` Claude Code) — включите `normalizeVolatileSystem: true` и убедитесь, что запросы реально попадают на того же провайдера. `proxitor doctor` покажет загруженный конфиг; лог чтений кэша в консоли прокси — попадания.

**Anthropic возвращает `400` про смешанные TTL при `cacheControlTtl: 1h`.** Поставьте `rewriteBlockTtl: auto` (или `always`), чтобы привести клиентские блочные `cache_control`-брейкпойнты к тому же TTL — см. [справочник по конфигурации](./configuration.ru.md#кэширование-подсказок).

**OpenRouter возвращает `400 invalid_prompt | Invalid Responses API request` на `/v1/responses`.** Некоторые клиенты отправляют айтемы `input` без поля `type`, которое требует OpenRouter. `normalizeResponses: auto` (по умолчанию) проставляет его, переносит `role:"system"` в `instructions` и добавляет `id`/`status`, которые OpenRouter ждёт от assistant-истории. Ставьте `skip` только для чистого passthrough.

**Строгие провайдеры режектят `role:"system"` внутри `/v1/messages`.** Некоторые клиенты (например, внедрённый вывод хука `SessionStart`) ставят айтем `role:"system"` в середину треда в `messages`; Anthropic Messages API разрешает там только `user`/`assistant`, поэтому провайдеры вроде OpenRouter → GLM возвращают `400 ... messages[n].role: Input should be 'user' or 'assistant'`. Включите `normalizeMessages: true` (по умолчанию выкл; меню Fixes или per-model override), чтобы перенести текст такого айтема в top-level поле `system` и убрать его из `messages`. Действует только на `/v1/messages`.

**Провайдер переключается между запросами.** Убедитесь, что `sessionId` не `skip` — и `auto` (по умолчанию), и `always` инжектят липкий session ID; без него OpenRouter закрепляет провайдера только после первого попадания в кэш.

**Изменения конфига не применяются.** Должны — proxitor подхватывает файл на лету. Если файл битый, прокси держит последний валидный конфиг; `proxitor config validate` покажет, что именно отвергнуто.

## Разработка

PR приветствуются — см. **[CONTRIBUTING.md](../CONTRIBUTING.md)** (установка, тесты, коммиты, changeset'ы).

## Лицензия

[MIT](../LICENSE)
