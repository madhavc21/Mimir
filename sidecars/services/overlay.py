import win32gui
import win32ui
import win32con
import win32api
import sys
import ctypes

ctypes.windll.user32.SetProcessDPIAware() # To prevent DPI scaling, causing mismatch bw mouse coords and screen coords

# Globals for rectangle selection
# These act as state variables, maintaining a current state info of user actions
# These will be mutated by functions based on user actions on the window

class OverlayWindow:
    def __init__(self):
        self.start_pos = None # The first click pos (start of rect), mutated only once in wnd_proc, when wnd_proc is called with LBUTTONDOWN message
        self.end_pos = None # The mouse release pos (end of rect), continuously mutated in wnd_proc as long as user is dragging cursor, till BUTTONUP, ie; wnd_proc is called while selecting == True, and with msg == WM_MOUSEMOVE
        self.selecting = False # The selection/mouse drag check, mutated in wnd_proc first at BUTTONDOWN, to indicate start of selection, mutated back to false when wnd_proc called w BUTTONUP message

    def wnd_proc(self, hwnd, msg, wparam, lparam):
        """
        wnd_proc: Window Procedure, is a function that must be defined to handle itneractions with our custom window (ID:hwnd).
        This function is called by Win32 whenever an interaction occurs on our window.
        Windows asks this function how it wants to handle a message(interaction) on our window
        Most simply, it's contract/signature is like so:
        function_name(
            param1: hwnd - The window handle id returned after creating a window. This ID enables windows to recognise the window we created out of all it's other processes, and attach respective processes to it.
            param2: msg - This is a message id, which corresponds to a win32con id, referring any valid interaction with the window associated with hwnd. Eg, clicks, mouse move, resize etc
            param3, param4: wparam, lparam - Any extra data depending on the msg 
        )
        [write handles for messages/interactions]
        return win32gui.DefWindowProc(hwnd, msg, wparam, lparam) 
        where `DefWindowProc` is ensures that any/all unhandled msg is forwarded to windows to perform it's default procedure. This prevents any unhandled messages
        """

        if msg == win32con.WM_LBUTTONDOWN:
            self.selecting = True
            self.start_pos = win32api.GetCursorPos()
            return 0 # return 0 -> msg handled

        if msg == win32con.WM_MOUSEMOVE and self.selecting:
            self.end_pos = win32api.GetCursorPos()
            win32gui.InvalidateRect(hwnd, None, True)
            return 0

        if msg == win32con.WM_LBUTTONUP:
            self.selecting = False
            self.end_pos = win32api.GetCursorPos()
            win32gui.PostQuitMessage(0) # Exists message loop
            return 0

        if msg == win32con.WM_PAINT:
            hdc, ps = win32gui.BeginPaint(hwnd)
            if self.start_pos and self.end_pos:
                x1, y1 = self.start_pos
                x2, y2 = self.end_pos
                win32gui.Rectangle(hdc, x1, y1, x2, y2)
            win32gui.EndPaint(hwnd, ps)
            return 0

        return win32gui.DefWindowProc(hwnd, msg, wparam, lparam)


    def create_overlay(self):
        """
        This function defines, registers and creates the custom window.
        
        """
        wc = win32gui.WNDCLASS()                            # Creating windowclass object (internally a C struct), window customizations will be set on this object
        wc.lpfnWndProc = self.wnd_proc                           # Sets our custom wndproc -> this sets the window behaviour
        wc.lpszClassName = "OverlayWindow"                  # Sets a classname/window name to refer the window by
        wc.hCursor = win32gui.LoadCursor(                   # Sets the cursor type on our window                     
            None,                                               # ?
            win32con.IDC_CROSS                                  # ID for cross cursor, indication draw
            )
        wc.hbrBackground = win32con.COLOR_WINDOW + 1        # Sets the window background color (+1?)

        class_atom = win32gui.RegisterClass(wc)             # Registers the custom configured class, returning an atom which is just an ID to the registered window

        screen_w = win32api.GetSystemMetrics(0)             # Gets System's screen width, to set the window's width for full screen
        screen_h = win32api.GetSystemMetrics(1)             # Gets System's screen height, to set the window's height for full screen

        hwnd = win32gui.CreateWindowEx(
            win32con.WS_EX_TOPMOST | win32con.WS_EX_LAYERED, # Extended styles: always-on-top + transparency; win32con.WS_EX_LAYERED enables transperancy
            class_atom,                                      # Which window class (template) to use
            None,                                            # No title (popup window)
            win32con.WS_POPUP,                               # Borderless, decoration-free window
            0, 0, screen_w, screen_h,                        # Fullscreen overlay
            None,                                            # No parent → top-level window
            None,                                            # No menu
            None,                                            # hInstance (handled by pywin32)
            None                                             # No custom creation data
        )


        # Configure how the window is composited (opacity), ie how it behaves w layers below it, if not set we get white opaque
        win32gui.SetLayeredWindowAttributes(
            hwnd, 
            0x000000,                                       # ignored because LWA_ALPHA is used
            120,                                            # 0 - 255, transparent -> opaque
            win32con.LWA_ALPHA                              # Applies uniform blending
        )

        # Make the window visible and schedule painting
        win32gui.ShowWindow(hwnd, win32con.SW_SHOW)

        # Enter message loop (blocks until PostQuitMessage)
        win32gui.PumpMessages()

        # Destroy window
        win32gui.DestroyWindow(hwnd)
        win32gui.UnregisterClass(wc.lpszClassName, None)
        
        # Return after user finishes interaction
        return (self.start_pos, self.end_pos)