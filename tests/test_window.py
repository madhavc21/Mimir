"""
Test Window for Notify Anything

Spawns a simple window that transitions from a "Loading" state
to a "Finished" state after a configurable delay.

Usage:
    python tests/test_window.py            # defaults: 10 second delay
    python tests/test_window.py --delay 5  # 5 second delay
"""
import tkinter as tk
import argparse

def create_test_window(delay: int = 10):
    root = tk.Tk()
    root.title("Test Target")
    root.geometry("300x200")
    root.configure(bg="#1a1a2e")

    label = tk.Label(
        root,
        text="⏳ Loading...",
        font=("Consolas", 24),
        fg="#e94560",
        bg="#1a1a2e"
    )
    label.pack(expand=True)

    countdown = tk.Label(
        root,
        text=f"{delay}s remaining",
        font=("Consolas", 12),
        fg="#888888",
        bg="#1a1a2e"
    )
    countdown.pack(pady=(0, 20))

    remaining = [delay]

    def tick():
        remaining[0] -= 1
        if remaining[0] > 0:
            countdown.config(text=f"{remaining[0]}s remaining")
            root.after(1000, tick)
        else:
            # THE VISUAL CHANGE
            root.configure(bg="#0f3460")
            label.config(text="✅ Finished!", fg="#00ff88", bg="#0f3460")
            countdown.config(text="Done", fg="#00ff88", bg="#0f3460")

    root.after(1000, tick)
    root.mainloop()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Spawn a test window for Notify Anything")
    parser.add_argument("--delay", type=int, default=30, help="Seconds before the visual change (default: 10)")
    args = parser.parse_args()
    create_test_window(delay=args.delay)
