# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Open-LLM-VTuber is a real-time voice-interactive AI companion with Live2D avatar support. It runs as a FastAPI WebSocket server (`src/open_llm_vtuber/`) that the browser frontend connects to. All AI engines (LLM, ASR, TTS, VAD) are modular and swappable via configuration.

## Essential Commands

```bash
uv sync                          # Install dependencies
uv run run_server.py             # Start server
uv run run_server.py --verbose   # Start with debug logging
uv run upgrade.py                # Update project
ruff check .                     # Lint
ruff format .                    # Format
pre-commit run --all-files       # Run all pre-commit hooks
```

Python 3.10–3.12 required. Package manager is `uv`. Bilibili live support requires the optional `bilibili` extra: `uv sync --extra bilibili`.

## Configuration

- `conf.yaml` — user config (not checked in; copied from `config_templates/conf.default.yaml`)
- `config_templates/conf.default.yaml` and `conf.ZH.default.yaml` — canonical defaults; always update both
- `characters/` — per-character YAML overrides; merged on top of `conf.yaml` via `deep_merge()` in `service_context.py`

Config is typed via Pydantic models in `src/open_llm_vtuber/config_manager/`. Top-level: `Config` → `SystemConfig` + `CharacterConfig` + `LiveConfig`. Character config nests `AgentConfig`, `ASRConfig`, `TTSConfig`, `VADConfig`, `TTSPreprocessorConfig`.

## Architecture

### Request Flow

```
Browser/Client
  └─ WebSocket /client-ws
       └─ routes.py → WebSocketHandler (websocket_handler.py)
            ├─ handle_new_connection() → copies ServiceContext, loads chat history
            ├─ handle_websocket_communication() → dispatch on msg type
            └─ conversation triggers → conversation_handler.py
                 ├─ process_single_conversation()  (single_conversation.py)
                 └─ process_group_conversation()   (group_conversation.py)
```

### ServiceContext (`service_context.py`)

Central per-connection dependency container. One instance per connected client. Holds references to all engine instances (asr, tts, vad, agent, translate) plus MCP components. Key methods:

- `load_from_config(config)` — full initialization from a config object; skips re-init if config unchanged
- `load_cache(...)` — fast path that copies references from a pre-built context (used for new connections)
- `handle_config_switch(websocket, config_file_name)` — hot-swaps character config at runtime
- `construct_system_prompt(persona_prompt)` — builds final system prompt by appending tool prompts from `system_config.tool_prompts`

### Engine Factory Pattern

All AI engines use the same factory pattern:

1. `XxxFactory.get_xxx_engine(model_name, **model_config)` dispatches to the concrete class
2. Concrete classes implement `XxxInterface` (abstract base class)
3. Config class for the engine lives in `config_manager/xxx.py`

Factories: `ASRFactory`, `TTSFactory`, `VADFactory`, `AgentFactory`, `StatelessLLMFactory`, `TranslateFactory`.

**ASRInterface** — must implement `transcribe_np(audio: np.ndarray) -> str`. Audio is always float32, 16 kHz mono.

**TTSInterface** — must implement `generate_audio(text, file_name_no_ext) -> str` returning a path to a wav file in `cache/`. Async variant `async_generate_audio` defaults to `asyncio.to_thread(generate_audio)`.

**AgentInterface** — must implement `chat(input: BaseInput) -> AsyncIterator[BaseOutput]`, `handle_interrupt(heard_response)`, and `set_memory_from_history(conf_uid, history_uid)`.

### Agent / LLM Architecture

Two-layer design:
- **StatelessLLM** (`stateless_llm/`) — thin wrappers around API clients; implement `chat_completion(messages, system, tools) -> AsyncIterator[str]`. No memory, no state.
- **Agent** (`agents/`) — wraps a StatelessLLM and adds memory, context management, interrupt handling, MCP tool dispatch. `BasicMemoryAgent` is the default.

`AgentFactory.create_agent()` receives `conversation_agent_choice` (e.g. `"basic_memory_agent"`, `"letta_agent"`) and the full config dicts; it instantiates the right agent.

### Conversation Pipeline

`process_single_conversation()` in `single_conversation.py`:
1. Send `conversation-chain-start` signal over WebSocket
2. Run ASR if input is audio (`np.ndarray`)
3. Call `agent_engine.chat(batch_input)` — yields `SentenceOutput | AudioOutput | dict`
4. `dict` items with `type == "tool_call_status"` → forwarded as-is to client
5. `SentenceOutput/AudioOutput` → `process_agent_output()` → TTS → audio sent to client
6. After stream ends, store assistant message in `chat_history/`

Interruption: the asyncio Task is cancelled; `agent.handle_interrupt(heard_response)` appends the partial response to memory.

### MCP Integration

`ServiceContext` initializes MCP components via `_init_mcp_components()`. Components:
- `ServerRegistry` — knows which servers are configured
- `ToolAdapter` — fetches tool schemas from servers and formats them for OpenAI/Codex tool-use APIs
- `ToolManager` — holds the formatted tool lists and raw tool dict
- `MCPClient` — executes tool calls against the MCP servers
- `ToolExecutor` — orchestrates MCPClient + ToolManager for BasicMemoryAgent

`ToolAdapter` and `ServerRegistry` are shared across connections; `MCPClient` and `ToolExecutor` are per-connection.

### WebSocket Message Types

Messages are JSON. The client sends types like `text-input`, `mic-audio-end`, `interrupt-signal`, `switch-config`. The server sends `conversation-chain-start`, `full-text`, `audio`, `backend-synth-complete`, `set-model-and-conf`, `error`, and `tool_call_status`.

## Key File Locations

| Purpose | Path |
|---|---|
| Server entry point | `run_server.py` |
| FastAPI app setup | `src/open_llm_vtuber/server.py` |
| WebSocket routing | `src/open_llm_vtuber/routes.py` |
| WebSocket message handling | `src/open_llm_vtuber/websocket_handler.py` |
| Per-connection state | `src/open_llm_vtuber/service_context.py` |
| Conversation orchestration | `src/open_llm_vtuber/conversations/` |
| Agent interfaces + impls | `src/open_llm_vtuber/agent/` |
| Config Pydantic models | `src/open_llm_vtuber/config_manager/` |
| Chat history (JSON files) | `chat_history/<conf_uid>/<history_uid>.json` |
| TTS audio cache | `cache/` |
| Live2D models | `live2d-models/<name>/<name>.model3.json` |
| Character config overrides | `characters/` |
| Prompt text files | `prompts/` |

## Adding a New Engine

1. Implement the interface (`XxxInterface`) in the appropriate `src/.../` directory
2. Register it in the factory (`XxxFactory`) — add a branch on `model_name`
3. Add a Pydantic config class in `config_manager/xxx.py` and register it in the parent config
4. Add default config entries to **both** `config_templates/conf.default.yaml` and `config_templates/conf.ZH.default.yaml`

## Coding Notes

- Logging uses **loguru** throughout; use `from loguru import logger`.
- All async I/O flows through FastAPI + asyncio. Sync engine methods run via `asyncio.to_thread`.
- `deep_merge(dict1, dict2)` in `service_context.py` merges character overrides; dict2 values win.
- `chat_history_manager.py` sanitizes path components to prevent directory traversal — always use its public API.
- `MessageHandler` (`message_handler.py`) provides a request/response correlation mechanism over WebSocket via `wait_for_response` / `handle_message`.
