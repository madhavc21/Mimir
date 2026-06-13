import win32clipboard
import time
import ctypes

def get_selected_text():
    # Hold clipboard open and backup all data currently in it
    saved_data = {}
    win32clipboard.OpenClipboard()
    try:
        # Enumerate all formats currently in the clipboard (Text, Images, Files, etc.)
        fmt = 0 # Start with 0 to get the first format 
        while True:
            fmt = win32clipboard.EnumClipboardFormats(fmt) # Pass the current fmt to get the next fmt
            if fmt == 0:
                break   # No more formats
            try:
                data = win32clipboard.GetClipboardData(fmt)
                saved_data[fmt] = data
            except: 
                continue # Some formats are weird, just skip them
    finally:
        win32clipboard.EmptyClipboard() # clear for our copy (so we can restore cleanly)
        win32clipboard.CloseClipboard()
    
    # Trigger "Copy" (using ctypes for a "cleaner" keypress than pyautogui)
    # This simulates: Ctrl Down -> C Down -> C Up -> Ctrl Up
    ctypes.windll.user32.keybd_event(0x10, 0, 2, 0) # Force SHIFT UP
    ctypes.windll.user32.keybd_event(0x11, 0, 0, 0) # Ctrl Down
    ctypes.windll.user32.keybd_event(0x43, 0, 0, 0) # C Down
    time.sleep(0.05) # A small delay to ensure the keypress is registered
    ctypes.windll.user32.keybd_event(0x43, 0, 2, 0) # C Up
    ctypes.windll.user32.keybd_event(0x11, 0, 2, 0) # Ctrl Up
    
    time.sleep(0.1) # delay to let app react
    win32clipboard.OpenClipboard()
    copied_text = ""
    try:
        # Check if copied item is UNICODE TEXT
        if win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_UNICODETEXT):
            copied_text = win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT)
    finally:
        # Restore clipboard
        win32clipboard.EmptyClipboard()
        for fmt, data in saved_data.items():
            try:
                win32clipboard.SetClipboardData(fmt,data)
            except:
                continue
        win32clipboard.CloseClipboard()
    
    return copied_text