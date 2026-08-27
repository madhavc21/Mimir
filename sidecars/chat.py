import sys
import json
import traceback
import os
import base64
import io

import litellm
litellm.drop_params = True

from PIL import Image
from litellm import get_valid_models

from services.logger import setup_logger
logger = setup_logger("chat")

SYSTEM_PROMPT = """
You are Mimir, a helpful AI assistant that lives in the user's desktop.

The user calls you via a hotkey and a pre-selected context.
The context may be a text or image snippet from the user's screen.
The user may ask you questions about the context.
Provide the user with the direct answer to the question, or additional helpful information based on the context.
If the context is empty then report the same to the user.
If the user asks you a question that is not related to the context, answer anyway.

## About yourself (Mimir the app)
If the user asks what you are, how you work, or what they can do — explain using these facts:

**Summoning & context**
- The user presses their capture hotkey from anywhere on their screen while Mimir is live (listening).
- If text is selected, that highlight becomes the chat context.
- If nothing is selected, a screen overlay appears; they drag a box around any region and that image becomes the context.
- They can press the hotkey again later to capture new context (e.g. after locking the card — see below).
- Clicking outside the chat card dismisses it and clears the in-memory session, unless the card is locked.

**Chat card** - where you live
- Double-click the card header to lock: the card stays open and on top; clicking outside no longer dismisses it - this is how you stay open for continuous conversations and to accept/request new context. Double-click again to unlock.
- Drag the header to move the card.
- Header controls: logo/title opens the Console window; + starts a new chat (keeps current capture context if present); history icon resumes saved threads; expand toggles fullscreen.
- Saved threads auto-save as they chat; thread names come from the first message.

**Console** (separate settings window)
- Home: live/sleep toggle — when sleeping, the hotkey does nothing.
- Chats: full thread list and larger chat panel.
- Model: API key, provider, and vision model selection.
- System: rebind capture hotkey, autostart on login, and whether the hotkey opens a new chat or the latest thread.
- About: app version and background on the Mimir name.

**System**: You are currently compatible for windows operating system only.

Answer feature questions directly and practically. 
If provided context is not enough to answer or understand the context, request more context (e.g. "double-click the header to lock, then press your hotkey again to add a new screenshot as context").
Do not invent features beyond what is listed here.


## Answering Behaviour

Answer in accordance to context and request complexity:
- If a one line (or few line) answer wholly satisfies the query, then limit the answer to the same
- If the query requires a concept breakdown, a complex definition, etc for the answer to be satisfactory, then do so.

Your answers must not include fluff and filler lines.
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _image_path_to_message(image_path):
    try:
        logger.debug("Encoding image to base64: %s", image_path)
        with Image.open(image_path) as img:
            if img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            base64_img = base64.b64encode(buf.getvalue()).decode("utf-8")
        return {
            "type": "image_url",
            "image_url": {
                "url": f"data:image/png;base64,{base64_img}"
            }
        }
    except Exception as e:
        logger.exception("Failed to encode image path: %s", image_path)
        raise e

def _unpack_history(history):
    logger.debug("Unpacking history. Message count: %d", len(history))
    history_unpacked = []
    for msg in history:
        if msg.get("role") == "user":
            user_content = [{"type": "text", "text": msg.get("content", "")}]
            image_path = msg.get("image_path")
            if image_path and image_path.lower() not in ("none", "null", ""):
                try:
                    user_content.append(_image_path_to_message(image_path))
                except Exception:
                    logger.warning("Skipping unreadable history image: %s", image_path)
            history_unpacked.append({"role": "user", "content": user_content})
        else:
            history_unpacked.append({"role": msg.get("role"), "content": msg.get("content")})
    return history_unpacked


def _full_model_id(provider: str, name: str) -> str:
    if "/" in name:
        return name
    return f"{provider}/{name}"


# ---------------------------------------------------------------------------
# Core inference
# ---------------------------------------------------------------------------

def inference(message, image_path, history, model="gemini/gemini-2.5-flash-lite", api_key=None):
    try:
        logger.info("Initializing inference. Model: %s", model)
        logger.debug("User prompt message: %s", message)
        logger.debug("Image path: %s", image_path)

        clean_image_path = None
        if image_path and image_path.lower() not in ("none", "null", ""):
            clean_image_path = image_path

        user_content = [{"type": "text", "text": message}]

        if clean_image_path:
            logger.info("Injecting image attachment to prompt content")
            user_content.append(_image_path_to_message(clean_image_path))

        messages_litellm = [
            {"role": "system", "content": SYSTEM_PROMPT},
            *_unpack_history(history),
            {"role": "user", "content": user_content}
        ]

        logger.info("Requesting LiteLLM completion stream...")
        partial_message = ""
        completion_kwargs = {
            "model": model,
            "messages": messages_litellm,
            "temperature": 0.7,
            "top_p": 0.9,
            "stream": True,
        }
        if api_key:
            completion_kwargs["api_key"] = api_key

        for chunk in litellm.completion(**completion_kwargs):
            choices = chunk.get('choices', [])
            if choices:
                delta = choices[0].get('delta', {})
                content = delta.get('content')
                if content is not None:
                    partial_message += content
            yield partial_message

        logger.info("Inference completed successfully. Total output length: %d chars", len(partial_message))

    except Exception:
        logger.exception("Exception occurred during model inference")
        raise


# ---------------------------------------------------------------------------
# Op implementations (called from daemon dispatch)
# ---------------------------------------------------------------------------

def _op_stream(req_id: str, message: str, image_path: str, history: list,
               model: str, api_key: str | None):
    """Stream tokens to stdout for a single request, then emit done."""
    clean_image_path = None
    if image_path and image_path.lower() not in ("none", "null", ""):
        clean_image_path = image_path

    if clean_image_path and not litellm.supports_vision(model):
        logger.error("Model %s does not support vision, but an image was supplied.", model)
        _write({"id": req_id, "status": "error", "message": "Selected model does not support vision"})
        return

    try:
        logger.info("[%s] Streaming tokens to stdout...", req_id)
        for partial_response in inference(message, image_path, history, model=model, api_key=api_key):
            _write({"token": partial_response})
        _write({"id": req_id, "type": "done"})
        logger.info("[%s] Stream complete", req_id)
    except Exception as e:
        logger.exception("[%s] Critical stream error", req_id)
        _write({"id": req_id, "status": "error", "message": str(e), "traceback": traceback.format_exc()})


def _op_list_providers(req_id: str):
    providers = sorted(litellm.models_by_provider.keys())
    _write({"id": req_id, "result": providers})
    _write({"id": req_id, "type": "done"})


def _op_list_models(req_id: str, provider: str, api_key: str | None):
    try:
        logger.info("[%s] Listing models for provider: %s", req_id, provider)
        live = None
        if api_key:
            try:
                live = get_valid_models(
                    check_provider_endpoint=True,
                    custom_llm_provider=provider,
                    api_key=api_key,
                )
            except Exception:
                logger.info("Live model list unavailable for %s, using catalog", provider)

        names = live if live else litellm.models_by_provider.get(provider, [])
        if not names:
            _write({"id": req_id, "status": "error", "message": f"Unknown provider: {provider}"})
            return

        result = []
        seen = set()
        for name in names:
            model_id = _full_model_id(provider, name)
            if model_id in seen:
                continue
            seen.add(model_id)
            result.append({"id": model_id, "supportsVision": litellm.supports_vision(model=model_id)})

        result = [m for m in result if m["supportsVision"]]
        result.sort(key=lambda m: m["id"])
        _write({"id": req_id, "result": result})
        _write({"id": req_id, "type": "done"})
    except Exception as e:
        logger.exception("[%s] Failed to list models", req_id)
        _write({"id": req_id, "status": "error", "message": str(e)})


# ---------------------------------------------------------------------------
# Stdout helper
# ---------------------------------------------------------------------------

def _write(obj: dict):
    print(json.dumps(obj), flush=True)


# ---------------------------------------------------------------------------
# Daemon entry point
# ---------------------------------------------------------------------------

def daemon_main():
    logger.info("Chat daemon starting up — imports loaded, emitting ready")
    _write({"type": "ready"})

    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        try:
            req = json.loads(raw_line)
        except json.JSONDecodeError as e:
            logger.warning("Daemon received invalid JSON: %s | error: %s", raw_line, e)
            _write({"status": "error", "message": f"Invalid JSON: {e}"})
            continue

        req_id = str(req.get("id", ""))
        op = req.get("op", "")
        logger.info("Daemon dispatching op=%s id=%s", op, req_id)

        if op == "stream":
            _op_stream(
                req_id=req_id,
                message=req.get("message", ""),
                image_path=req.get("image_path", ""),
                history=req.get("history", []),
                model=req.get("model", "gemini/gemini-2.5-flash-lite"),
                api_key=req.get("api_key") or None,
            )
        elif op == "list_providers":
            _op_list_providers(req_id)
        elif op == "list_models":
            _op_list_models(
                req_id=req_id,
                provider=req.get("provider", ""),
                api_key=req.get("api_key") or None,
            )
        else:
            logger.warning("Daemon received unknown op: %s", op)
            _write({"id": req_id, "status": "error", "message": f"Unknown op: {op}"})

    logger.info("Daemon stdin closed — exiting")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    logger.info("Chat sidecar starting up...")

    if len(sys.argv) >= 2 and sys.argv[1] == "--daemon":
        daemon_main()
        return

    # Legacy one-shot modes removed — all ops go through daemon stdin.
    logger.error("No mode specified. Use --daemon.")
    print(json.dumps({"status": "error", "message": "Use --daemon mode"}))
    sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("Chat sidecar terminated by KeyboardInterrupt")
        sys.exit(0)
