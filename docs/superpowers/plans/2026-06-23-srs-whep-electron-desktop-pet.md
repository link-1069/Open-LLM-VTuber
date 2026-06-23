# SRS WHEP + Electron Desktop Pet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Live2D avatar rendering with SRS WHEP video stream and package Open-LLM-VTuber as a transparent Windows desktop pet using Electron.

**Architecture:** Python FastAPI backend is kept intact (LLM/ASR/TTS/VAD unchanged). All Live2D code is removed from the Python side; the WebSocket protocol changes `audio` → `display-text` and `set-model-and-conf` → `set-conf`. A new Electron app in `electron/` spawns the Python server, shows a first-run URL input dialog, then plays the SRS WHEP stream in a transparent frameless window with a WebGL passthrough shader (chroma-key left as a TODO comment).

**Tech Stack:** Python 3.10–3.12 / uv / FastAPI / Pydantic v2 · Electron 31 · srs.sdk.js (SrsRtcWhipWhepAsync) · WebGL1

## Global Constraints

- Python version: `>=3.10,<3.13` (from `pyproject.toml`)
- Package manager: `uv` — all Python commands use `uv run` or `uv add`
- Linter/formatter: `ruff` — run `ruff check .` after every Python task; fix any errors before committing
- Electron version: `^31.0.0`
- SRS WHEP URL stored in Electron `userData/config.json`; Python backend never reads it
- `audio` WebSocket message is deprecated; replaced by `display-text` (text only, no base64 audio)
- `set-model-and-conf` WebSocket message replaced by `set-conf` (no `model_info` key)
- `live2d_expression_prompt` removed from system prompt construction
- Pydantic models use `populate_by_name=True`; extra fields in `conf.yaml` are silently ignored (no `extra='forbid'`)
- All code: UTF-8, CRLF line endings on Windows

---

## File Map

### Python — delete
| File | Reason |
|---|---|
| `src/open_llm_vtuber/live2d_model.py` | Entire Live2D model class |
| `model_dict.json` | Live2D model registry |

### Python — modify
| File | Change summary |
|---|---|
| `src/open_llm_vtuber/agent/transformers.py` | Remove `Live2dModel` import; simplify `actions_extractor()` to take no args, yield empty `Actions` |
| `src/open_llm_vtuber/agent/agents/basic_memory_agent.py` | Remove `live2d_model` param + `self._live2d_model`; change decorator call |
| `src/open_llm_vtuber/agent/agents/letta_agent.py` | Same as above |
| `src/open_llm_vtuber/agent/agent_factory.py` | Remove `live2d_model` param from `create_agent()` |
| `src/open_llm_vtuber/service_context.py` | Remove `live2d_model` attr, `init_live2d()`, expression prompt logic, change WS messages |
| `src/open_llm_vtuber/config_manager/character.py` | Remove `live2d_model_name` field |
| `src/open_llm_vtuber/conversations/tts_manager.py` | Remove `live2d_model`/`actions` params; send `display-text` instead of `prepare_audio_payload` |
| `src/open_llm_vtuber/conversations/conversation_utils.py` | Remove `live2d_model` from signatures and call sites |
| `src/open_llm_vtuber/websocket_handler.py` | Change `set-model-and-conf` → `set-conf`; remove `live2d_model=` from `load_cache()` call |
| `src/open_llm_vtuber/server.py` | Remove `/live2d-models` static mount |
| `src/open_llm_vtuber/routes.py` | Remove `GET /live2d-models/info` endpoint |
| `config_templates/conf.default.yaml` | Remove `live2d_model_name` + `live2d_expression_prompt` keys |
| `config_templates/conf.ZH.default.yaml` | Same |

### Electron — create (new directory `electron/`)
| File | Purpose |
|---|---|
| `electron/package.json` | Electron + electron-builder deps, start/build scripts |
| `electron/main.js` | Main process: window management, Python child process, IPC, config R/W |
| `electron/preload.js` | contextBridge: `getConfig`, `saveConfig`, `getWsUrl`, `openMainWindow` |
| `electron/.gitignore` | Ignore `node_modules/`, `dist/` |
| `electron/renderer/style.css` | Setup window styles |
| `electron/renderer/setup.html` | First-run WHEP URL input form |
| `electron/renderer/setup.js` | Validate URL, save config, open main window |
| `electron/renderer/main.html` | Transparent desktop pet window |
| `electron/renderer/renderer.js` | WebSocket client + SRS WHEP player + WebGL render loop |
| `electron/renderer/srs.sdk.js` | Downloaded from ossrs/srs (SrsRtcWhipWhepAsync) |

---

## Task 1: Simplify `actions_extractor` in `transformers.py`

**Files:**
- Modify: `src/open_llm_vtuber/agent/transformers.py`

**Interfaces:**
- Produces: `actions_extractor()` — zero-argument decorator; wraps an async generator that yields `SentenceWithTags | dict`; re-yields `(SentenceWithTags, Actions()) | dict`

- [ ] **Step 1: Edit `transformers.py`**

  Replace lines 1–9 (imports) — remove `Live2dModel`:

  ```python
  from typing import AsyncIterator, Tuple, Callable, List, Union, Dict, Any
  from functools import wraps
  from .output_types import Actions, SentenceOutput, DisplayText
  from ..utils.tts_preprocessor import tts_filter as filter_text
  from ..config_manager import TTSPreprocessorConfig
  from ..utils.sentence_divider import SentenceDivider
  from ..utils.sentence_divider import SentenceWithTags, TagState
  from loguru import logger
  ```

  Replace the entire `actions_extractor` function (lines 58–100) with:

  ```python
  def actions_extractor():
      """
      Decorator that yields (SentenceWithTags, Actions()) pairs.
      Actions are always empty — expression control removed with Live2D.
      """

      def decorator(
          func: Callable[..., AsyncIterator[Union[SentenceWithTags, Dict[str, Any]]]],
      ) -> Callable[..., AsyncIterator[Union[Tuple[SentenceWithTags, Actions], Dict[str, Any]]]]:
          @wraps(func)
          async def wrapper(
              *args, **kwargs
          ) -> AsyncIterator[Union[Tuple[SentenceWithTags, Actions], Dict[str, Any]]]:
              async for item in func(*args, **kwargs):
                  if isinstance(item, SentenceWithTags):
                      yield item, Actions()
                  elif isinstance(item, dict):
                      yield item
                  else:
                      logger.warning(
                          f"actions_extractor received unexpected type: {type(item)}"
                      )

          return wrapper

      return decorator
  ```

- [ ] **Step 2: Verify lint passes**

  ```
  ruff check src/open_llm_vtuber/agent/transformers.py
  ```
  Expected: no output (no errors).

- [ ] **Step 3: Commit**

  ```bash
  git add src/open_llm_vtuber/agent/transformers.py
  git commit -m "refactor: remove Live2dModel dependency from actions_extractor"
  ```

---

## Task 2: Remove `live2d_model` from `BasicMemoryAgent` and `LettaAgent`

**Files:**
- Modify: `src/open_llm_vtuber/agent/agents/basic_memory_agent.py`
- Modify: `src/open_llm_vtuber/agent/agents/letta_agent.py`

**Interfaces:**
- Consumes: `actions_extractor()` from Task 1 (no arguments)
- Produces: `BasicMemoryAgent.__init__(llm, system, tts_preprocessor_config, faster_first_response, segment_method, use_mcpp, interrupt_method, tool_prompts, tool_manager, tool_executor, mcp_prompt_string)` — `live2d_model` removed
- Produces: `LettaAgent.__init__(id, tts_preprocessor_config, faster_first_response, segment_method, host, port)` — `live2d_model` removed

- [ ] **Step 1: Edit `basic_memory_agent.py`**

  Remove `live2d_model` from `__init__` signature and body (lines 42–56 area):

  ```python
  def __init__(
      self,
      llm: StatelessLLMInterface,
      system: str,
      tts_preprocessor_config: TTSPreprocessorConfig = None,
      faster_first_response: bool = True,
      segment_method: str = "pysbd",
      use_mcpp: bool = False,
      interrupt_method: Literal["system", "user"] = "user",
      tool_prompts: Dict[str, str] = None,
      tool_manager: Optional[ToolManager] = None,
      tool_executor: Optional[ToolExecutor] = None,
      mcp_prompt_string: str = "",
  ):
      """Initialize agent with LLM and configuration."""
      super().__init__()
      self._memory = []
      self._tts_preprocessor_config = tts_preprocessor_config
      # (remove self._live2d_model = live2d_model)
  ```

  Change the decorator in `_chat_function_factory` (line 588):

  ```python
  @tts_filter(self._tts_preprocessor_config)
  @display_processor()
  @actions_extractor()
  @sentence_divider(
      faster_first_response=self._faster_first_response,
      segment_method=self._segment_method,
      valid_tags=["think"],
  )
  async def chat_with_memory(
  ```

- [ ] **Step 2: Edit `letta_agent.py`**

  Remove `live2d_model` from `__init__` signature and body:

  ```python
  def __init__(
      self,
      id,
      tts_preprocessor_config: TTSPreprocessorConfig = None,
      faster_first_response: bool = True,
      segment_method: str = "pysbd",
      host: str = "localhost",
      port: int = 8283,
  ):
      super().__init__()
      self.url = f"http://{host}:{port}"
      self.client = Letta(base_url=self.url)
      self.id = id
      self._tts_preprocessor_config = tts_preprocessor_config
      self._faster_first_response = faster_first_response
      self._segment_method = segment_method

      self.chat = tts_filter(self._tts_preprocessor_config)(
          display_processor()(
              actions_extractor()(
                  sentence_divider(
                      faster_first_response=self._faster_first_response,
                      segment_method=self._segment_method,
                      valid_tags=["think"],
                  )(self.chat)
              )
          )
      )
  ```

- [ ] **Step 3: Verify lint passes**

  ```
  ruff check src/open_llm_vtuber/agent/agents/basic_memory_agent.py src/open_llm_vtuber/agent/agents/letta_agent.py
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add src/open_llm_vtuber/agent/agents/basic_memory_agent.py src/open_llm_vtuber/agent/agents/letta_agent.py
  git commit -m "refactor: remove live2d_model from BasicMemoryAgent and LettaAgent"
  ```

---

## Task 3: Remove `live2d_model` from `AgentFactory`, `ServiceContext`, and `CharacterConfig`

**Files:**
- Modify: `src/open_llm_vtuber/agent/agent_factory.py`
- Modify: `src/open_llm_vtuber/service_context.py`
- Modify: `src/open_llm_vtuber/config_manager/character.py`

**Interfaces:**
- Consumes: `BasicMemoryAgent(llm, system, ...)` without `live2d_model` (Task 2)
- Consumes: `LettaAgent(id, ...)` without `live2d_model` (Task 2)
- Produces: `AgentFactory.create_agent(conversation_agent_choice, agent_settings, llm_configs, system_prompt, tts_preprocessor_config, **kwargs)` — `live2d_model` removed
- Produces: `ServiceContext.load_cache(config, system_config, character_config, asr_engine, tts_engine, vad_engine, agent_engine, translate_engine, mcp_server_registery, tool_adapter, send_text, client_uid)` — `live2d_model` removed
- Produces: `CharacterConfig` — `live2d_model_name` field removed

- [ ] **Step 1: Edit `agent_factory.py`**

  Remove `live2d_model=None` from `create_agent()` signature and all three call sites:

  ```python
  @staticmethod
  def create_agent(
      conversation_agent_choice: str,
      agent_settings: dict,
      llm_configs: dict,
      system_prompt: str,
      tts_preprocessor_config=None,
      **kwargs,
  ) -> Type[AgentInterface]:
  ```

  In the `basic_memory_agent` branch, remove `live2d_model=live2d_model,` from `BasicMemoryAgent(...)`.
  In the `mem0_agent` branch, remove `live2d_model=live2d_model,` from `Mem0LLM(...)`.
  In the `letta_agent` branch, remove `live2d_model=live2d_model,` from `LettaAgent(...)`.

- [ ] **Step 2: Edit `service_context.py`**

  **2a. Remove import:**
  ```python
  # Delete this line:
  from .live2d_model import Live2dModel
  ```

  **2b. Remove attribute from `__init__`:**
  ```python
  # Delete this line:
  self.live2d_model: Live2dModel = None
  ```

  **2c. Remove from `__str__`:**
  ```python
  # Delete this line:
  f"  Live2D Model: {self.live2d_model.model_info if self.live2d_model else 'Not Loaded'}\n"
  ```

  **2d. Remove `init_live2d()` method entirely** (lines 314–321):
  ```python
  # Delete entire method:
  # def init_live2d(self, live2d_model_name: str) -> None:
  #     ...
  ```

  **2e. Remove from `load_cache()` signature and body:**
  ```python
  # Remove parameter:
  # live2d_model: Live2dModel,
  # Remove assignment:
  # self.live2d_model = live2d_model
  ```

  **2f. Remove from `load_from_config()`:**
  ```python
  # Delete this line:
  # self.init_live2d(config.character_config.live2d_model_name)
  ```

  **2g. Remove from `init_agent()` call inside `load_from_config()`:**
  ```python
  # In the AgentFactory.create_agent() call, remove:
  # live2d_model=self.live2d_model,
  ```

  **2h. In `construct_system_prompt()`, remove the `live2d_expression_prompt` branch:**
  ```python
  # Delete these lines:
  # if prompt_name == "live2d_expression_prompt":
  #     prompt_content = prompt_content.replace(
  #         "[<insert_emomap_keys>]", self.live2d_model.emo_str
  #     )
  ```

  **2i. In `handle_config_switch()`, change the first `send_text` call:**
  ```python
  await websocket.send_text(
      json.dumps(
          {
              "type": "set-conf",
              "conf_name": self.character_config.conf_name,
              "conf_uid": self.character_config.conf_uid,
          }
      )
  )
  ```
  (Remove the `"model_info": self.live2d_model.model_info,` line.)

- [ ] **Step 3: Edit `config_manager/character.py`**

  Remove the `live2d_model_name` field declaration and its `DESCRIPTIONS` entry:

  ```python
  class CharacterConfig(I18nMixin):
      conf_name: str = Field(..., alias="conf_name")
      conf_uid: str = Field(..., alias="conf_uid")
      # live2d_model_name removed
      character_name: str = Field(default="", alias="character_name")
      human_name: str = Field(default="Human", alias="human_name")
      avatar: str = Field(default="", alias="avatar")
      persona_prompt: str = Field(..., alias="persona_prompt")
      agent_config: AgentConfig = Field(..., alias="agent_config")
      asr_config: ASRConfig = Field(..., alias="asr_config")
      tts_config: TTSConfig = Field(..., alias="tts_config")
      vad_config: VADConfig = Field(..., alias="vad_config")
      tts_preprocessor_config: TTSPreprocessorConfig = Field(
          ..., alias="tts_preprocessor_config"
      )

      DESCRIPTIONS: ClassVar[Dict[str, Description]] = {
          "conf_name": Description(
              en="Name of the character configuration", zh="角色配置名称"
          ),
          "conf_uid": Description(
              en="Unique identifier for the character configuration",
              zh="角色配置唯一标识符",
          ),
          # live2d_model_name Description entry removed
          "character_name": Description(
              en="Name of the AI character in conversation", zh="对话中AI角色的名字"
          ),
          # ... rest unchanged
      }
  ```

- [ ] **Step 4: Verify lint passes**

  ```
  ruff check src/open_llm_vtuber/agent/agent_factory.py src/open_llm_vtuber/service_context.py src/open_llm_vtuber/config_manager/character.py
  ```
  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/open_llm_vtuber/agent/agent_factory.py src/open_llm_vtuber/service_context.py src/open_llm_vtuber/config_manager/character.py
  git commit -m "refactor: remove live2d_model from AgentFactory, ServiceContext, CharacterConfig"
  ```

---

## Task 4: Change `audio` → `display-text` in TTS pipeline

**Files:**
- Modify: `src/open_llm_vtuber/conversations/tts_manager.py`
- Modify: `src/open_llm_vtuber/conversations/conversation_utils.py`

**Interfaces:**
- Produces: `TTSTaskManager.speak(tts_text, display_text, tts_engine, websocket_send)` — `live2d_model` and `actions` removed
- Produces: WebSocket message `{"type": "display-text", "display_text": {"text": "...", "name": "...", "avatar": "..."}}`

- [ ] **Step 1: Edit `tts_manager.py`**

  **1a. Remove imports:**
  ```python
  # Remove these two imports:
  # from ..live2d_model import Live2dModel
  # from ..utils.stream_audio import prepare_audio_payload
  ```
  Also remove `Actions` from output_types import if it's only used for type hints in removed params:
  ```python
  from ..agent.output_types import DisplayText
  # (Actions no longer needed in this file)
  ```

  **1b. Change `speak()` signature** — remove `actions` and `live2d_model`:
  ```python
  async def speak(
      self,
      tts_text: str,
      display_text: DisplayText,
      tts_engine: TTSInterface,
      websocket_send: WebSocketSend,
  ) -> None:
  ```

  **1c. Change `_send_silent_payload()` signature** — remove `actions`:
  ```python
  async def _send_silent_payload(
      self,
      display_text: DisplayText,
      sequence_number: int,
  ) -> None:
      """Queue a display-text payload (no audio)"""
      payload = {
          "type": "display-text",
          "display_text": display_text.to_dict() if display_text else None,
      }
      await self._payload_queue.put((payload, sequence_number))
  ```

  **1d. Change `_process_tts()` signature** — remove `actions` and `live2d_model`:
  ```python
  async def _process_tts(
      self,
      tts_text: str,
      display_text: DisplayText,
      tts_engine: TTSInterface,
      sequence_number: int,
  ) -> None:
      """Generate TTS audio (for inference model) and queue display-text payload."""
      audio_file_path = None
      try:
          audio_file_path = await self._generate_audio(tts_engine, tts_text)
          payload = {
              "type": "display-text",
              "display_text": display_text.to_dict() if display_text else None,
          }
          await self._payload_queue.put((payload, sequence_number))
      except Exception as e:
          logger.error(f"Error preparing display-text payload: {e}")
          payload = {
              "type": "display-text",
              "display_text": display_text.to_dict() if display_text else None,
          }
          await self._payload_queue.put((payload, sequence_number))
      finally:
          if audio_file_path:
              tts_engine.remove_file(audio_file_path)
              logger.debug("Audio cache file cleaned.")
  ```

  **1e. Update the `speak()` body** to remove `actions` and `live2d_model` from `_send_silent_payload` and the `asyncio.create_task` call:
  ```python
  async def speak(
      self,
      tts_text: str,
      display_text: DisplayText,
      tts_engine: TTSInterface,
      websocket_send: WebSocketSend,
  ) -> None:
      if len(re.sub(r'[\s.,!?，。！？\'"』」）】\s]+', "", tts_text)) == 0:
          logger.debug("Empty TTS text, sending silent display payload")
          current_sequence = self._sequence_counter
          self._sequence_counter += 1
          if not self._sender_task or self._sender_task.done():
              self._sender_task = asyncio.create_task(
                  self._process_payload_queue(websocket_send)
              )
          await self._send_silent_payload(display_text, current_sequence)
          return

      logger.debug(f"🏃Queuing TTS task for: '''{tts_text}''' (by {display_text.name})")
      current_sequence = self._sequence_counter
      self._sequence_counter += 1
      if not self._sender_task or self._sender_task.done():
          self._sender_task = asyncio.create_task(
              self._process_payload_queue(websocket_send)
          )
      task = asyncio.create_task(
          self._process_tts(
              tts_text=tts_text,
              display_text=display_text,
              tts_engine=tts_engine,
              sequence_number=current_sequence,
          )
      )
      self.task_list.append(task)
  ```

- [ ] **Step 2: Edit `conversation_utils.py`**

  **2a. Remove import:**
  ```python
  # Remove:
  # from ..live2d_model import Live2dModel
  ```

  **2b. Remove `live2d_model` from `process_agent_output()` and `handle_sentence_output()` signatures:**
  ```python
  async def process_agent_output(
      output: Union[AudioOutput, SentenceOutput],
      character_config: Any,
      tts_engine: TTSInterface,
      websocket_send: WebSocketSend,
      tts_manager: TTSTaskManager,
      translate_engine: Optional[Any] = None,
  ) -> str:
  ```
  ```python
  async def handle_sentence_output(
      output: SentenceOutput,
      tts_engine: TTSInterface,
      websocket_send: WebSocketSend,
      tts_manager: TTSTaskManager,
      translate_engine: Optional[Any] = None,
  ) -> str:
  ```

  **2c. Update `tts_manager.speak()` call** in `handle_sentence_output` — remove `actions=` and `live2d_model=`:
  ```python
  async for display_text, tts_text, actions in output:
      logger.debug(f"🏃 Processing output: '''{tts_text}'''...")

      if translate_engine:
          if len(re.sub(r'[\s.,!?，。！？\'"』」）】\s]+', "", tts_text)):
              tts_text = translate_engine.translate(tts_text)
          logger.info(f"🏃 Text after translation: '''{tts_text}'''...")

      full_response += display_text.text
      await tts_manager.speak(
          tts_text=tts_text,
          display_text=display_text,
          tts_engine=tts_engine,
          websocket_send=websocket_send,
      )
  ```

  **2d. Update call sites** for `process_agent_output()` in `single_conversation.py` and `group_conversation.py`:

  In `single_conversation.py` around line 105:
  ```python
  response_part = await process_agent_output(
      output=output_item,
      character_config=context.character_config,
      tts_engine=context.tts_engine,
      websocket_send=websocket_send,
      tts_manager=tts_manager,
      translate_engine=context.translate_engine,
  )
  ```
  (Remove `live2d_model=context.live2d_model,`.)

  Do the same in `group_conversation.py` — search for `process_agent_output` and remove the `live2d_model=` argument.

- [ ] **Step 3: Verify lint**

  ```
  ruff check src/open_llm_vtuber/conversations/
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add src/open_llm_vtuber/conversations/tts_manager.py src/open_llm_vtuber/conversations/conversation_utils.py src/open_llm_vtuber/conversations/single_conversation.py src/open_llm_vtuber/conversations/group_conversation.py
  git commit -m "refactor: replace audio WebSocket message with display-text"
  ```

---

## Task 5: Update `websocket_handler.py`, `server.py`, `routes.py`, config templates; delete dead files; verify server starts

**Files:**
- Modify: `src/open_llm_vtuber/websocket_handler.py`
- Modify: `src/open_llm_vtuber/server.py`
- Modify: `src/open_llm_vtuber/routes.py`
- Modify: `config_templates/conf.default.yaml`
- Modify: `config_templates/conf.ZH.default.yaml`
- Delete: `src/open_llm_vtuber/live2d_model.py`
- Delete: `model_dict.json`

**Interfaces:**
- Produces: WebSocket `set-conf` message on new connection: `{"type": "set-conf", "conf_name": "...", "conf_uid": "...", "client_uid": "..."}`

- [ ] **Step 1: Edit `websocket_handler.py`**

  **1a.** In `_send_initial_messages()` (around line 160), change the second `send_text` call:
  ```python
  await websocket.send_text(
      json.dumps(
          {
              "type": "set-conf",
              "conf_name": session_service_context.character_config.conf_name,
              "conf_uid": session_service_context.character_config.conf_uid,
              "client_uid": client_uid,
          }
      )
  )
  ```
  (Remove `"model_info": session_service_context.live2d_model.model_info,`.)

  **1b.** In `_init_service_context()` (around line 183), remove `live2d_model=` from `load_cache()` call:
  ```python
  await session_service_context.load_cache(
      config=self.default_context_cache.config.model_copy(deep=True),
      system_config=self.default_context_cache.system_config.model_copy(deep=True),
      character_config=self.default_context_cache.character_config.model_copy(deep=True),
      asr_engine=self.default_context_cache.asr_engine,
      tts_engine=self.default_context_cache.tts_engine,
      vad_engine=self.default_context_cache.vad_engine,
      agent_engine=self.default_context_cache.agent_engine,
      translate_engine=self.default_context_cache.translate_engine,
      mcp_server_registery=self.default_context_cache.mcp_server_registery,
      tool_adapter=self.default_context_cache.tool_adapter,
      send_text=send_text,
      client_uid=client_uid,
  )
  ```

- [ ] **Step 2: Edit `server.py`**

  Remove the `/live2d-models` static file mount block (4 lines):
  ```python
  # Delete:
  # self.app.mount(
  #     "/live2d-models",
  #     CORSStaticFiles(directory="live2d-models"),
  #     name="live2d-models",
  # )
  ```

- [ ] **Step 3: Edit `routes.py`**

  Remove the entire `GET /live2d-models/info` endpoint function (`async def get_live2d_folder_info():` and its body, approximately lines 96–139).

- [ ] **Step 4: Edit `config_templates/conf.default.yaml`**

  Remove line 32:
  ```yaml
  # Delete:
  #   live2d_model_name: 'mao_pro'
  ```
  Remove line 12:
  ```yaml
  # Delete:
  #     live2d_expression_prompt: 'live2d_expression_prompt'
  ```

- [ ] **Step 5: Edit `config_templates/conf.ZH.default.yaml`**

  Same two lines as Step 4 (equivalent Chinese version).

- [ ] **Step 6: Delete dead files**

  ```bash
  git rm src/open_llm_vtuber/live2d_model.py model_dict.json
  ```

- [ ] **Step 7: Verify full lint**

  ```
  ruff check .
  ```
  Expected: no errors.

- [ ] **Step 8: Verify server starts**

  ```bash
  uv run run_server.py
  ```
  Expected output (within 30 seconds):
  ```
  INFO:     Application startup complete.
  INFO:     Uvicorn running on http://localhost:12393
  ```
  Stop with Ctrl-C. If there are import errors, fix them before continuing.

- [ ] **Step 9: Commit**

  ```bash
  git add config_templates/conf.default.yaml config_templates/conf.ZH.default.yaml
  git add src/open_llm_vtuber/websocket_handler.py src/open_llm_vtuber/server.py src/open_llm_vtuber/routes.py
  git commit -m "refactor: remove Live2D routing, config keys, and dead files"
  ```

---

## Task 6: Electron scaffold — `package.json`, `main.js`, `preload.js`

**Files:**
- Create: `electron/package.json`
- Create: `electron/main.js`
- Create: `electron/preload.js`
- Create: `electron/.gitignore`

**Interfaces:**
- Produces: IPC channels `get-config`, `save-config`, `get-ws-url`, `open-main-window`
- Produces: `userData/config.json` schema `{ whep_url: string, last_updated: string }`

- [ ] **Step 1: Create `electron/.gitignore`**

  ```
  node_modules/
  dist/
  out/
  ```

- [ ] **Step 2: Create `electron/package.json`**

  ```json
  {
    "name": "open-llm-vtuber-desktop",
    "version": "1.0.0",
    "description": "Open-LLM-VTuber desktop pet",
    "main": "main.js",
    "scripts": {
      "start": "electron .",
      "build": "electron-builder --win --x64"
    },
    "devDependencies": {
      "electron": "^31.0.0",
      "electron-builder": "^24.13.3"
    },
    "build": {
      "appId": "com.open-llm-vtuber.desktop",
      "productName": "Open-LLM-VTuber",
      "directories": { "output": "dist" },
      "win": {
        "target": "nsis",
        "icon": "../assets/icon.ico"
      },
      "files": [
        "**/*",
        "!node_modules",
        "!dist"
      ],
      "extraResources": [
        {
          "from": "../",
          "to": "app",
          "filter": [
            "src/**",
            "run_server.py",
            "conf.yaml",
            "config_templates/**",
            "characters/**",
            "prompts/**",
            "pyproject.toml",
            "uv.lock"
          ]
        }
      ]
    }
  }
  ```

- [ ] **Step 3: Create `electron/main.js`**

  ```javascript
  const { app, BrowserWindow, ipcMain } = require('electron')
  const path = require('path')
  const fs = require('fs')
  const { spawn } = require('child_process')

  const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json')
  const PROJECT_ROOT = path.join(__dirname, '..')
  const SERVER_PORT = 12393

  let mainWindow = null
  let setupWindow = null
  let pythonProcess = null

  function readConfig() {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    } catch {
      return {}
    }
  }

  function writeConfig(cfg) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8')
  }

  function spawnPython() {
    pythonProcess = spawn('uv', ['run', 'run_server.py'], {
      cwd: PROJECT_ROOT,
      shell: true,
    })
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Python server startup timeout (30s)')),
        30000
      )
      pythonProcess.stdout.on('data', (data) => {
        const text = data.toString()
        console.log('[Python]', text.trimEnd())
        if (text.includes('Application startup complete')) {
          clearTimeout(timeout)
          resolve()
        }
      })
      pythonProcess.stderr.on('data', (data) => {
        console.error('[Python stderr]', data.toString().trimEnd())
      })
      pythonProcess.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  }

  function createMainWindow() {
    mainWindow = new BrowserWindow({
      width: 480,
      height: 800,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      hasShadow: false,
      resizable: true,
      skipTaskbar: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'main.html'))
    mainWindow.on('closed', () => { mainWindow = null })
  }

  function createSetupWindow() {
    setupWindow = new BrowserWindow({
      width: 520,
      height: 240,
      resizable: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    setupWindow.loadFile(path.join(__dirname, 'renderer', 'setup.html'))
    setupWindow.on('closed', () => { setupWindow = null })
  }

  app.whenReady().then(async () => {
    ipcMain.handle('get-config', () => readConfig())
    ipcMain.handle('save-config', (_, cfg) => { writeConfig(cfg); return true })
    ipcMain.handle('get-ws-url', () => `ws://localhost:${SERVER_PORT}/client-ws`)
    ipcMain.handle('open-main-window', () => {
      if (setupWindow) setupWindow.close()
      createMainWindow()
    })

    try {
      await spawnPython()
      console.log('Python server ready.')
    } catch (e) {
      console.error('Python server failed to start:', e.message)
      // Continue anyway — user may have server running separately
    }

    const cfg = readConfig()
    if (cfg.whep_url) {
      createMainWindow()
    } else {
      createSetupWindow()
    }
  })

  app.on('before-quit', () => {
    if (pythonProcess) {
      pythonProcess.kill()
      pythonProcess = null
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  ```

- [ ] **Step 4: Create `electron/preload.js`**

  ```javascript
  const { contextBridge, ipcRenderer } = require('electron')

  contextBridge.exposeInMainWorld('electronAPI', {
    getConfig:      () => ipcRenderer.invoke('get-config'),
    saveConfig:     (cfg) => ipcRenderer.invoke('save-config', cfg),
    getWsUrl:       () => ipcRenderer.invoke('get-ws-url'),
    openMainWindow: () => ipcRenderer.invoke('open-main-window'),
  })
  ```

- [ ] **Step 5: Install dependencies**

  ```bash
  cd electron && npm install
  ```
  Expected: `node_modules/` created, no errors.

- [ ] **Step 6: Smoke-test Electron launches**

  ```bash
  cd electron && npm start
  ```
  Expected: Electron window opens (setup or main depending on userData). Close it.

- [ ] **Step 7: Commit**

  ```bash
  git add electron/
  git commit -m "feat: add Electron scaffold with Python process management and IPC"
  ```

---

## Task 7: Electron setup window

**Files:**
- Create: `electron/renderer/style.css`
- Create: `electron/renderer/setup.html`
- Create: `electron/renderer/setup.js`

**Interfaces:**
- Consumes: `window.electronAPI.saveConfig({ whep_url, last_updated })`, `window.electronAPI.openMainWindow()`
- Produces: WHEP URL saved to `userData/config.json`; main window opened on confirm

- [ ] **Step 1: Create `electron/renderer/style.css`**

  ```css
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #1e1e1e;
    color: #e0e0e0;
  }

  .setup-body {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
  }

  .setup-container {
    width: 460px;
    padding: 28px;
    background: #2a2a2a;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  }

  .setup-container h2 {
    margin-bottom: 10px;
    font-size: 17px;
    font-weight: 600;
  }

  .setup-container .hint {
    margin-bottom: 12px;
    font-size: 12px;
    color: #888;
  }

  .setup-container input[type="text"] {
    width: 100%;
    padding: 9px 12px;
    background: #3a3a3a;
    border: 1px solid #555;
    border-radius: 6px;
    color: #e0e0e0;
    font-size: 13px;
    margin-bottom: 14px;
    outline: none;
  }

  .setup-container input[type="text"]:focus {
    border-color: #4a90e2;
  }

  .btn-row {
    display: flex;
    gap: 10px;
    margin-bottom: 10px;
  }

  .btn-row button {
    flex: 1;
    padding: 9px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: opacity 0.15s;
  }

  #btn-test   { background: #444; color: #e0e0e0; }
  #btn-confirm { background: #4a90e2; color: #fff; }
  #btn-confirm:disabled { background: #3a5a8a; color: #888; cursor: not-allowed; }

  #status {
    font-size: 12px;
    min-height: 16px;
    color: #aaa;
  }
  #status.ok  { color: #5cb85c; }
  #status.err { color: #d9534f; }
  ```

- [ ] **Step 2: Create `electron/renderer/setup.html`**

  ```html
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <title>配置数字人连接</title>
    <link rel="stylesheet" href="style.css">
  </head>
  <body class="setup-body">
    <div class="setup-container">
      <h2>配置数字人连接</h2>
      <p class="hint">输入 SRS WHEP 拉流地址，后续启动将自动连接</p>
      <input
        type="text"
        id="whep-url"
        placeholder="http://localhost:1985/rtc/v1/whep/?app=live&stream=avatar"
      />
      <div class="btn-row">
        <button id="btn-test">连接测试</button>
        <button id="btn-confirm" disabled>确认保存</button>
      </div>
      <p id="status"></p>
    </div>
    <script src="setup.js"></script>
  </body>
  </html>
  ```

- [ ] **Step 3: Create `electron/renderer/setup.js`**

  ```javascript
  const urlInput  = document.getElementById('whep-url')
  const btnTest   = document.getElementById('btn-test')
  const btnConfirm = document.getElementById('btn-confirm')
  const statusEl  = document.getElementById('status')

  function setStatus(msg, type) {
    statusEl.textContent = msg
    statusEl.className = type || ''
  }

  btnTest.addEventListener('click', async () => {
    const url = urlInput.value.trim()
    if (!url) { setStatus('请输入地址', 'err'); return }
    setStatus('测试中...')
    btnTest.disabled = true
    try {
      // Send a minimal SDP POST to check if the WHEP endpoint is reachable.
      // A 200/201 means success; 400 means server reached but bad SDP (still reachable).
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: 'v=0\r\n',
      })
      if ([200, 201, 400, 404].includes(resp.status)) {
        setStatus('✓ 服务器可达', 'ok')
        btnConfirm.disabled = false
      } else {
        setStatus(`✗ 服务器返回 HTTP ${resp.status}`, 'err')
      }
    } catch (e) {
      setStatus(`✗ 无法连接: ${e.message}`, 'err')
    }
    btnTest.disabled = false
  })

  btnConfirm.addEventListener('click', async () => {
    const url = urlInput.value.trim()
    if (!url) return
    await window.electronAPI.saveConfig({
      whep_url: url,
      last_updated: new Date().toISOString(),
    })
    await window.electronAPI.openMainWindow()
  })

  // Allow pressing Enter in the input to trigger test
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnTest.click()
  })
  ```

- [ ] **Step 4: Test setup window manually**

  ```bash
  # Delete cached config so setup window appears
  # Windows PowerShell:
  Remove-Item -ErrorAction SilentlyContinue "$env:APPDATA\open-llm-vtuber-desktop\config.json"

  cd electron && npm start
  ```
  Expected:
  - Setup window appears centered
  - Enter a WHEP URL and click "连接测试" — status shows reachable or error
  - Click "确认保存" — window closes, main window opens (may be blank canvas at this stage)
  - Restart `npm start` — setup window does NOT appear (cached URL used)

- [ ] **Step 5: Commit**

  ```bash
  git add electron/renderer/style.css electron/renderer/setup.html electron/renderer/setup.js
  git commit -m "feat: add Electron first-run setup window for WHEP URL configuration"
  ```

---

## Task 8: Electron main window — SRS WHEP player + WebGL passthrough shader

**Files:**
- Create: `electron/renderer/main.html`
- Create: `electron/renderer/renderer.js`
- Download: `electron/renderer/srs.sdk.js`

**Interfaces:**
- Consumes: `window.electronAPI.getConfig()` → `{ whep_url }`
- Consumes: `window.electronAPI.getWsUrl()` → `"ws://localhost:12393/client-ws"`
- Consumes: WebSocket messages `display-text`, `set-conf`, `full-text`, `error`, `conversation-chain-start`, `backend-synth-complete`
- Produces: `SrsRtcWhipWhepAsync.play(whep_url)` → video displayed on WebGL canvas

- [ ] **Step 1: Download `srs.sdk.js`**

  ```powershell
  Invoke-WebRequest `
    -Uri "https://raw.githubusercontent.com/ossrs/srs/develop/trunk/research/players/js/srs.sdk.js" `
    -OutFile "electron/renderer/srs.sdk.js"
  ```
  Expected: file created, size > 10 KB.

- [ ] **Step 2: Create `electron/renderer/main.html`**

  ```html
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }

      html, body {
        width: 100vw;
        height: 100vh;
        background: transparent;
        overflow: hidden;
        /* Allow dragging the window by clicking anywhere not interactive */
        -webkit-app-region: drag;
      }

      #canvas {
        position: absolute;
        top: 0; left: 0;
        width: 100%; height: 100%;
        /* Canvas itself should not drag (it handles WebGL) */
        -webkit-app-region: no-drag;
      }

      #subtitle {
        position: absolute;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.55);
        color: #fff;
        padding: 6px 16px;
        border-radius: 20px;
        font-size: 14px;
        max-width: 80%;
        text-align: center;
        pointer-events: none;
        -webkit-app-region: no-drag;
        display: none;
        white-space: pre-wrap;
      }

      #video {
        /* Hidden source for WebGL — audio plays from here */
        display: none;
      }
    </style>
  </head>
  <body>
    <canvas id="canvas"></canvas>
    <video id="video" autoplay playsinline></video>
    <div id="subtitle"></div>

    <script src="srs.sdk.js"></script>
    <script src="renderer.js"></script>
  </body>
  </html>
  ```

- [ ] **Step 3: Create `electron/renderer/renderer.js`**

  ```javascript
  'use strict'

  const canvas   = document.getElementById('canvas')
  const video    = document.getElementById('video')
  const subtitle = document.getElementById('subtitle')
  const gl       = canvas.getContext('webgl')

  if (!gl) {
    console.error('WebGL not supported')
  }

  // ─── WebGL shader setup (passthrough placeholder) ────────────────────────────

  const VERT_SRC = `
    attribute vec2 aPos;
    varying vec2 vUV;
    void main() {
      vUV = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `

  // Passthrough fragment shader.
  // TODO: Replace with chroma-key shader — discard pixels where green channel
  // dominates (greenness = color.g - max(color.r, color.b) > threshold).
  const FRAG_SRC = `
    precision mediump float;
    uniform sampler2D uVideo;
    varying vec2 vUV;
    void main() {
      vec4 color = texture2D(uVideo, vec2(vUV.x, 1.0 - vUV.y));
      // TODO: chroma key
      // float greenness = color.g - max(color.r, color.b);
      // if (greenness > 0.35) discard;
      gl_FragColor = color;
    }
  `

  function compileShader(type, src) {
    const s = gl.createShader(type)
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('Shader compile error: ' + gl.getShaderInfoLog(s))
    }
    return s
  }

  const prog = gl.createProgram()
  gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, VERT_SRC))
  gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, FRAG_SRC))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('Shader link error: ' + gl.getProgramInfoLog(prog))
  }
  gl.useProgram(prog)

  // Full-screen quad: two triangles via TRIANGLE_STRIP
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1,  1, -1,  -1, 1,  1, 1]),
    gl.STATIC_DRAW
  )
  const aPos = gl.getAttribLocation(prog, 'aPos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  // Video texture
  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

  // ─── Canvas resize ────────────────────────────────────────────────────────────

  function resizeCanvas() {
    canvas.width  = window.innerWidth
    canvas.height = window.innerHeight
    gl.viewport(0, 0, canvas.width, canvas.height)
  }
  window.addEventListener('resize', resizeCanvas)
  resizeCanvas()

  // ─── Render loop ─────────────────────────────────────────────────────────────

  function renderFrame() {
    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    requestAnimationFrame(renderFrame)
  }
  requestAnimationFrame(renderFrame)

  // ─── SRS WHEP player ─────────────────────────────────────────────────────────

  let sdk = null

  async function startStream(whepUrl) {
    if (sdk) { sdk.close(); sdk = null }
    sdk = new SrsRtcWhipWhepAsync()
    video.srcObject = sdk.stream
    try {
      const session = await sdk.play(whepUrl)
      console.log('SRS session:', session.sessionid)
      await video.play()
    } catch (e) {
      console.error('SRS stream error:', e)
      // Retry after 5 s
      setTimeout(() => startStream(whepUrl), 5000)
    }
  }

  // ─── Subtitle display ────────────────────────────────────────────────────────

  let subtitleTimer = null

  function showSubtitle(text) {
    subtitle.textContent = text
    subtitle.style.display = 'block'
    clearTimeout(subtitleTimer)
    subtitleTimer = setTimeout(() => { subtitle.style.display = 'none' }, 5000)
  }

  // ─── WebSocket connection ─────────────────────────────────────────────────────

  async function connectWs() {
    const [config, wsUrl] = await Promise.all([
      window.electronAPI.getConfig(),
      window.electronAPI.getWsUrl(),
    ])

    // Start video stream
    if (config.whep_url) {
      startStream(config.whep_url)
    }

    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      console.log('WebSocket connected to Python backend')
    }

    ws.onmessage = (ev) => {
      let msg
      try { msg = JSON.parse(ev.data) } catch { return }

      switch (msg.type) {
        case 'display-text':
          if (msg.display_text?.text) showSubtitle(msg.display_text.text)
          break
        case 'full-text':
          // Informational — log only
          console.log('[full-text]', msg.text)
          break
        case 'set-conf':
          console.log('[conf]', msg.conf_name, msg.conf_uid)
          break
        case 'error':
          console.error('[backend error]', msg.message)
          break
        default:
          // Other messages (group info, history, etc.) — ignore for now
          break
      }
    }

    ws.onerror = (e) => console.error('WebSocket error:', e)

    ws.onclose = () => {
      console.warn('WebSocket closed — reconnecting in 3 s')
      setTimeout(connectWs, 3000)
    }
  }

  connectWs()
  ```

- [ ] **Step 4: Test main window manually**

  ```bash
  # Ensure config.json has a whep_url (from Task 7 setup, or set manually)
  cd electron && npm start
  ```
  Expected:
  - Transparent frameless window appears
  - Console shows "WebSocket connected to Python backend" and "SRS session: ..." (if SRS is running)
  - If no SRS running: `SrsRtcWhipWhepAsync` logs a connection error every 5 s — normal
  - Dragging the window by clicking and moving works (WebGL canvas allows drag via `body`)
  - Start Python backend separately (`uv run run_server.py`), restart Electron — WebSocket connects, `set-conf` appears in console

- [ ] **Step 5: Commit**

  ```bash
  git add electron/renderer/main.html electron/renderer/renderer.js electron/renderer/srs.sdk.js
  git commit -m "feat: add Electron main window with WebGL passthrough shader and SRS WHEP player"
  ```

---

## Self-Review

**Spec coverage check:**
- ✅ Remove Live2D from backend → Tasks 1–5
- ✅ `audio` → `display-text` protocol → Task 4
- ✅ `set-model-and-conf` → `set-conf` → Task 5
- ✅ Remove `live2d_expression_prompt` from system prompt → Task 3 (service_context)
- ✅ Electron transparent window + always-on-top + drag → Task 6 (main.js window options)
- ✅ Python child process spawn → Task 6 (main.js `spawnPython`)
- ✅ First-run URL input dialog → Task 7 (setup window)
- ✅ `userData/config.json` caching → Task 6 (main.js `readConfig`/`writeConfig`)
- ✅ SRS WHEP via `srs.sdk.js` → Task 8
- ✅ WebGL passthrough shader with TODO comment → Task 8
- ✅ Subtitle display for `display-text` messages → Task 8

**TTS audio file lifecycle:** TTS still generated in `tts_manager._generate_audio()` and deleted in `finally` — spec says "file is deleted as before" ✅

**Type consistency check:**
- `actions_extractor()` (Task 1) → called as `@actions_extractor()` in Tasks 2 ✅
- `TTSTaskManager.speak(tts_text, display_text, tts_engine, websocket_send)` (Task 4) → call site in Task 4 step 2c matches ✅
- `load_cache(...)` without `live2d_model` (Task 3) → call site in Task 5 step 1b matches ✅
- `process_agent_output(output, character_config, tts_engine, websocket_send, tts_manager, translate_engine)` (Task 4) → call in Task 4 step 2d matches ✅
- IPC channel names: `get-config`, `save-config`, `get-ws-url`, `open-main-window` — consistent across `main.js`, `preload.js`, `setup.js`, `renderer.js` ✅
