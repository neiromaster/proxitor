# proxitor

<p align="center">
  <strong>Прозрачный прокси для AI CLI-инструментов.</strong><br/>
  Фиксируйте провайдеров. Держите кэш подсказок живым. Снижайте расходы.<br/>
  Ваши инструменты ничего не замечают.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/proxitor"><img src="https://img.shields.io/npm/v/proxitor?color=6366f1&labelColor=1e2327&label=npm" alt="npm version"></a>
  <a href="../LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e?labelColor=1e2327" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-3b82f6?labelColor=1e2327" alt="Node.js ≥ 22">
  <a href="https://github.com/neiromaster/proxitor/issues"><img src="https://img.shields.io/github/issues/neiromaster/proxitor?color=f59e0b&labelColor=1e2327&label=issues" alt="GitHub issues"></a>
</p>

🌍 [English](../README.md) · **Русский**

<p align="center"><img src="./assets/proxitor-wizard.gif" alt="мастер настройки proxitor" width="640"></p>

---

## Как это работает

```
ваш AI-инструмент  →  proxitor  →  OpenRouter  →  выбранный вами провайдер
```

Proxitor встаёт между Claude Code, Codex или любым CLI, совместимым с Anthropic/OpenAI, и [OpenRouter](https://openrouter.ai). Один ключ — все модели, но **вы** решаете, какой провайдер обслуживает каждый запрос, и заставляете кэширование подсказок наконец-то работать.

## Проблема кэширования

OpenRouter балансирует нагрузку между провайдерами, а **кэш подсказок привязан к провайдеру**: кэш, собранный на Anthropic, не поможет, когда следующий запрос улетит на DeepInfra. Claude Code отправляет большой системный промпт в каждом запросе, поэтому без зафиксированного провайдера вы каждый раз платите по полной.

Закрепите `claude-*` за `anthropic` — и системный промпт закэшируется после первого попадания. Последующие запросы стоят крохи.

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
proxitor
# Listening on http://0.0.0.0:8828
```

**3. Натравите на него инструмент**

```sh
# Claude Code
ANTHROPIC_BASE_URL=http://localhost:8828/v1 claude

# Codex
OPENAI_BASE_URL=http://localhost:8828/v1 codex
```

Это вся настройка. Запросы идут через proxitor; стримящиеся ответы проходят без изменений.

## Конфигурация

Удобный путь — интерактивное меню, без всякого YAML.

```sh
proxitor config         # открыть меню
proxitor config wizard  # (пере)запустить мастер настройки
proxitor config browse  # изучить модели + цены
```

В меню можно задать API-ключ и подключение, выбрать маршрутизацию по моделям (с живыми ценами провайдеров), настроить кэширование, добавлять и редактировать переопределения моделей. Меню тянет живые данные из OpenRouter, так что вы листаете реальные модели и провайдеров с актуальными ценами.

<p align="center"><img src="./assets/proxitor-add.gif" alt="proxitor: добавить переопределение модели" width="640"></p>

Предпочитаете править файл? Полный **[справочник по конфигурации](./configuration.ru.md)** покрывает маршрутизацию провайдеров, переопределения по моделям, заголовки, режимы кэширования и все опции. [`proxitor.config.example.yaml`](../proxitor.config.example.yaml) — шаблон с комментариями.

## Диагностика

```sh
proxitor doctor   # проверяет окружение, конфиг, ключ, сеть, порт, версию
```

Он печатает понятный отчёт и выходит с ненулевым кодом, если что-то не так — удобно и из CI (`--json`, `--offline`, `--timeout`).

Пока proxitor работает, он логирует использование кэша из апстрима — видно, помогает ли кэширование на самом деле:

```
[abc123] Cache read: 50000, write: 25000 tokens (99.6% hit)
```

Быстрая проверка здоровья: `curl http://localhost:8828/health`.

## Команды

| Команда | Описание |
|---|---|
| `proxitor` | Запустить прокси (команда по умолчанию) |
| `proxitor config` | Интерактивное меню настроек |
| `proxitor config wizard` | Мастер настройки |
| `proxitor config browse` | Изучить модели + цены |
| `proxitor doctor` | Продиагностировать всё |
| `proxitor --help` | Полный список флагов |

Частые флаги: `--port`, `--host`, `--config <путь>`, `--openrouter-key <ключ>`.

## Разработка

PR приветствуются — см. **[CONTRIBUTING.md](../CONTRIBUTING.md)** (установка, тесты, коммиты, changeset'ы).

## Лицензия

[MIT](../LICENSE)
