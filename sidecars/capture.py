import sys
import json
import traceback
from pathlib import Path
import time

from services.logger import setup_logger
logger = setup_logger("capture")

# Resolve the absolute path of the directory containing this script,
# then get its parent directory (the project root)
if getattr(sys, "frozen", False):
    # ponytail: onefile extracts to _MEIPASS, not next to the .exe
    root_dir = Path(getattr(sys, "_MEIPASS", sys.executable))
else:
    root_dir = Path(__file__).resolve().parent

if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

try:
    from services.capture_text import get_selected_text
    from services.capture_snippet import capture_selected_bmp
    from services.overlay import OverlayWindow
except ImportError as e:
    logger.exception("capture service import failed: %s", e)
    get_selected_text = None
    capture_selected_bmp = None
    
def _get_region(start: tuple, end: tuple):
    """
    Gets the origin nomalized screen relative points of the selected region
    
    :param start: x,y coordinates of the selection start
    :type start: tuple
    :param end: x,y coordinates of the selection end
    :type end: tuple
    """
    x1, y1 = start 
    x2, y2 = end

    # Need to normalize the coordinates relative to screen top-left (0,0). x-axis is top-left -> top-right, y-axis is top-left -> bottom left
    # User may drag in any direction
    # p1, p2 are directional 

    # min as the smaller x value will be nearer to origin, which is the left side of screen
    left = min(x1, x2) 

    # min as the smaller y value will be nearer to origin, which is the top side of screen
    top = min(y1, y2)

    # abs because directional info is not relevant
    width = abs(x2 - x1)
    height = abs(y2 - y1)

    return left, top, width, height

def main():
    try:
        if get_selected_text is None:
            raise ImportError("Could not import win32 text capture service")
        if capture_selected_bmp is None:
            raise ImportError("Could not import win32 image capture service")
        
        logger.info("Starting capture..")
        
        force_overlay = "--force-overlay" in sys.argv
        if not force_overlay:
            # First attempt to capture text
            text = get_selected_text()
            if text:
                print(json.dumps({"status": "success", "type":"text", "result": text})) 
                return
        
        overlay = OverlayWindow()
        region = overlay.create_overlay()

        # region = (None,None) is truthy in python
        if not region or not region[0] or not region[1]:
            print(json.dumps({"status":"error", "message": f"Selection failed: No region selected"}))
            return

        x,y,w,h = _get_region(region[0], region[1])

        if w<5 or h<5: # if w or h is less than 5px, invalid region
            print(json.dumps({"status":"error", "message": f"Invalid selection: Please make a larger selection"}))
            return
        import tempfile
        snippets_dir = Path(tempfile.gettempdir()) / "mimir_snippets"
        snippets_dir.mkdir(exist_ok=True)
        save_path = str(snippets_dir / f"capture_{int(time.time())}.png")
        capture_selected_bmp(x,y,w,h, save=True, save_name=save_path)
        # ponytail: SaveBitmapFile writes BMP; re-encode so path + API mime match
        from PIL import Image
        with Image.open(save_path) as img:
            img.convert("RGB").save(save_path, format="PNG")
        print(json.dumps({"status": "success", "type":"image", "result": save_path}))
        
        return   
    except Exception as e:
        print(json.dumps(
            {
                "status": "error",
                "message": str(e),
                "traceback": traceback.format_exc()
            }
        ))
        return

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)