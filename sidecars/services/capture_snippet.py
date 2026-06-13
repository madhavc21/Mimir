import win32gui
import win32ui
import win32con
from ctypes import windll

import time

import hashlib
from pathlib import Path

ROOT = Path(__file__).parent.parent
SNIPPETS = ROOT / "snippets"
SNIPPETS.mkdir(exist_ok=True)
save_path = SNIPPETS 

def capture_selected_bmp(x, y, w, h, save: bool = True, save_name: str = save_path):
    hdc_screen = win32gui.GetDC(0)           # A DC, Device Context is drawing surface, ie the graphical context you want. In this case we 0 -> desktop window; This returns an HDC (a raw handle) that lets me READ pixels from the screen context.
    bmp = None                               # initialize to None so finally block can ignore if not created
    hdc_mem = None
    hdc_screen_obj = None
    
    try:
        hdc_screen_obj = win32ui.CreateDCFromHandle(hdc_screen) # wraps the same raw DC into a python object, enabling function calls on it. hdc_screen is now an reuseable DC object. Creates a Python useable DC obj from raw handle
        bmp = win32ui.CreateBitmap()                        # Creates/initializes an empty bitmap obj, no pixel memory
        bmp.CreateCompatibleBitmap(hdc_screen_obj, w, h)    # Allocates pixel memory ie; properties, h,w,color compatible w screen

        hdc_mem = hdc_screen_obj.CreateCompatibleDC()       # Creates an invisible DC/canvas in memory that follows the same pixel rules as hdc_screen, (ie pixel depth etc.). This is to ensure source and destination are compatible, and pixel conversion is not required when pixel transfer happens. Returns a python DC obj
        hdc_mem.SelectObject(bmp)                           # Attaches the template bmp we created to the mem dc, ie; specifying a place where writes to this dc should go

                                                            # BitBlockTransfer; Transfers pixels from source to destination:
        hdc_mem.BitBlt(                                     # dest.BitBlt(
            (0, 0),                                             # starting from top-left of dest bitmap
            (w, h),                                             # Our selection size w, h
            hdc_screen_obj,                                     # The Source of pixels to transfer; here the screen dc we refered to
            (x, y),                                             # The starting position of our selection in screen
            win32con.SRCCOPY                                    # Copy the pixels exactly
            )                                               # )
        # BitBlt reads pixels from source dc and writes them directly into the destination DC's selcted bitmap
        
        if save:
            Path(save_name).parent.mkdir(parents=True, exist_ok=True)
            bmp.SaveBitmapFile(hdc_mem, str(save_name))          # Saves the bmp at address hdc_mem to a disk address
        
    finally:
        # NOTE clean up 
        if bmp is not None:
            win32gui.DeleteObject(bmp.GetHandle())
        if hdc_mem is not None:
            hdc_mem.DeleteDC()                                  # IMPORTANT: Delete the mem DC
        if hdc_screen_obj is not None:
            hdc_screen_obj.DeleteDC()                           # IMPROTANT: Delete the screen DC wrapper
        if hdc_screen is not None:
            win32gui.ReleaseDC(0, hdc_screen)                   # IMPROTANT: Release the raw screen HDC
    
    return 