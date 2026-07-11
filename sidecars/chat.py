import sys
import json
import traceback
import litellm
import os

litellm.drop_params = True
import base64
import io

from PIL import Image

from litellm import get_valid_models

from services.logger import setup_logger
logger = setup_logger("chat")

MIMIR_API_KEY_ENV = "MIMIR_API_KEY"

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

"""

def _api_key():
    return os.environ.get(MIMIR_API_KEY_ENV) or None

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
            user_content = [
                {
                    "type": "text",
                    "text": msg.get("content", "")
                }
            ]
            history_unpacked.append(
                {
                "role": "user", 
                "content": user_content
            })
        else:
            history_unpacked.append(
                {
                    "role": msg.get("role"),
                    "content": msg.get("content")
                }
            )
    return history_unpacked

def inference(message, image_path, history, model="gemini/gemini-2.5-flash-lite", api_key=None):
    try:
        logger.info("Initializing inference. Model: %s", model)
        logger.debug("User prompt message: %s", message)
        logger.debug("Image path: %s", image_path)
        
        clean_image_path = None
        if image_path and image_path.lower() not in ("none", "null", ""):
            clean_image_path = image_path

        user_content = [
            {
                "type": "text",
                "text": message
            }
        ]
        
        if clean_image_path:
            logger.info("Injecting image attachment to prompt content")
            user_content.append(_image_path_to_message(clean_image_path))
            
        messages_litellm = [
            {
                "role": "system",
                "content": SYSTEM_PROMPT
            },
            *_unpack_history(history),
            {
                "role": "user", 
                "content": user_content
            }
        ]
        
        logger.info("Requesting LiteLLM completion stream...")
        partial_message = ""
        completion_kwargs = {
            "model": model,
            "messages": messages_litellm,
            "max_tokens": 512,
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
        
    except Exception as e:
        logger.exception("Exception occurred during model inference")
        raise

def _full_model_id(provider: str, name: str) -> str:
    if "/" in name:
        return name
    return f"{provider}/{name}"

def list_providers():
    providers = sorted(litellm.models_by_provider.keys())
    print(json.dumps(providers))
    sys.stdout.flush()

def list_models_for_provider(provider: str):
    try:
        api_key = _api_key()
        logger.info("Listing models for provider: %s", provider)
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
            print(json.dumps({"status": "error", "message": f"Unknown provider: {provider}"}))
            sys.exit(1)
        result = []
        seen = set()
        for name in names:
            model_id = _full_model_id(provider, name)
            if model_id in seen:
                continue
            seen.add(model_id)
            result.append({
                "id": model_id,
                "supportsVision": litellm.supports_vision(model=model_id),
            })
        result = [m for m in result if m["supportsVision"]]
        result.sort(key=lambda m: m["id"])
        print(json.dumps(result))
        sys.stdout.flush()
    except Exception as e:
        logger.exception("Failed to list models")
        print(json.dumps({"status": "error", "message": str(e)}))
        sys.exit(1)

def stream_for_rust(message, image_path, history, model="gemini/gemini-2.5-flash-lite"):
    api_key = _api_key()
    clean_image_path = None
    if image_path and image_path.lower() not in ("none", "null", ""):
        clean_image_path = image_path

    if clean_image_path:
        if not litellm.supports_vision(model):
            logger.error("Model %s does not support vision, but an image was supplied.", model)
            print(json.dumps({"status": "error", "message": "Selected model does not support vision"}))
            sys.exit(1)

    try:
        logger.info("Streaming tokens to stdout...")
        for partial_response in inference(message, image_path, history, model=model, api_key=api_key):
            payload = json.dumps({"token": partial_response})
            print(payload)
            sys.stdout.flush()

    except Exception as e:
        logger.exception("Critical stream error in stream_for_rust")
        print(json.dumps({"status": "error", "message": str(e), "traceback": traceback.format_exc()}))

def main():
    logger.info("Chat sidecar starting up...")

    if len(sys.argv) >= 2 and sys.argv[1] == "--list-providers":
        list_providers()
        return

    if len(sys.argv) >= 2 and sys.argv[1] == "--list-models":
        provider = sys.argv[2] if len(sys.argv) > 2 else ""
        if not provider:
            print(json.dumps({"status": "error", "message": "Provider required"}))
            sys.exit(1)
        list_models_for_provider(provider)
        return

    if len(sys.argv) < 4:
        logger.error("Insufficient CLI arguments received: %s", sys.argv)
        print(json.dumps({"status": "error", "message": "Insufficient arguments", "traceback": traceback.format_exc()}))
        sys.exit(1)
        
    message = sys.argv[1]
    image_path = sys.argv[2]
    
    try:
        history_json = json.loads(sys.argv[3])
    except Exception as e:
        logger.exception("Failed to parse history JSON argument")
        print(json.dumps({"status": "error", "message": "Failed to parse history JSON", "traceback": traceback.format_exc()}))
        sys.exit(1)

    model = sys.argv[4] if len(sys.argv) > 4 else "gemini/gemini-2.5-flash-lite"
    if "/" not in model:
        print(json.dumps({"status": "error", "message": f"Model must be provider/model format, got: {model}"}))
        sys.exit(1)

    stream_for_rust(message, image_path, history_json, model=model)
    
if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("Chat sidecar terminated by KeyboardInterrupt")
        sys.exit(0)
