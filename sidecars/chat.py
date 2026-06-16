import sys
import json
import traceback
import litellm
import os
import base64

from services.logger import setup_logger
logger = setup_logger("chat")

# In production, GEMINI_API_KEY is injected by Rust from the Tauri secure store.
# In development, fall back to the local .env file if the key is not yet configured.
if not os.environ.get("GEMINI_API_KEY"):
    print(json.dumps({
        "status": "error",
        "message": "GEMINI_API_KEY not set — this should have been caught by Rust."
    }))
    sys.exit(1)

SYSTEM_PROMPT = """
You are Mimir, a helpful AI assistant.
The user has highlighted some text from their screen (under "Highlighted Text:") and is asking you a question about it.
Answer the question and provide the user with additional helpful information based on the highlighted text.
If highlighted text is empty then report the same to the user.
"""

def _image_path_to_message(image_path):
    try:
        logger.debug("Encoding image to base64: %s", image_path)
        with open(image_path, "rb") as image_bytes:
            base64_img = base64.b64encode(image_bytes.read()).decode('utf-8')
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
            ## Skip images in history
            # image_path = msg.get("image_path", "")
            # if image_path:
            #     user_content.append(_image_path_to_message(image_path))
                
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

def inference(message, image_path, history, model="gemini/gemini-2.5-flash-lite"):
    try:
        logger.info("Initializing inference. Model: %s", model)
        logger.debug("User prompt message: %s", message)
        logger.debug("Image path: %s", image_path)
        
        # Check for empty/None strings from shell
        clean_image_path = None
        if image_path and image_path.lower() not in ("none", "null", ""):
            clean_image_path = image_path

        # Construct user message
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
        for chunk in litellm.completion(model=model,
                                        # api_base="x.x.x.x:xxxx",
                                        messages=messages_litellm,
                                        max_new_tokens=512,
                                        temperature=.7,
                                        top_k=100,
                                        top_p=.9,
                                        repetition_penalty=1.18,
                                        stream=True):
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
        yield f"An Error occurred: {e}"
        
def normalize_model(model_id):
    if not model_id:
        return "gemini/gemini-2.5-flash-lite"
    if "/" in model_id:
        return model_id
    return f"gemini/{model_id}"

def stream_for_rust(message, image_path, history, model="gemini/gemini-2.5-flash-lite"):
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
        for partial_response in inference(message, image_path, history, model=model):
            payload = json.dumps({"token": partial_response})
            
            # Force OS to push this chunk
            print(payload)
            sys.stdout.flush() # Flush the payload out of python's temporary buffer to terminal/pipe -> rust memory

    except Exception as e:
        logger.exception("Critical stream error in stream_for_rust")
        print(json.dumps({"status": "error", "message": str(e), "traceback": traceback.format_exc()}))

def main():
    logger.info("Chat sidecar starting up...")
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

    model = normalize_model(sys.argv[4] if len(sys.argv) > 4 else "")
    stream_for_rust(message, image_path, history_json, model=model)
    
if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("Chat sidecar terminated by KeyboardInterrupt")
        sys.exit(0)