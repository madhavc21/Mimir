import logging
from pathlib import Path

import sys

def setup_logger(service: str) -> logging.Logger:
    """
    Configures logging to write to 'sidecars/logs'
    Returns module specific logger.
    """
    if getattr(sys, "frozen", False):
        import tempfile
        # In production, write logs to the OS Temp directory to avoid Program Files permission errors
        logs_dir = Path(tempfile.gettempdir()) / "mimir_logs"
    else:
        # In development, write logs to the local sidecars/logs folder
        sidecar_root = Path(__file__).resolve().parent.parent
        logs_dir = sidecar_root / 'logs'
        
    logs_dir.mkdir(exist_ok=True)
    log_file = logs_dir / 'sidecar.log'
    
    # 1. Silences root logger (hides httpx, litellm, etc. debug spam)
    logging.getLogger().setLevel(logging.WARNING)
    
    # 2. Get the specific logger for our code
    logger = logging.getLogger(service)
    logger.setLevel(logging.DEBUG)
    
    # 3. Create the file handler if it doesn't exist yet
    if not logger.handlers:
        file_handler = logging.FileHandler(str(log_file), encoding="utf-8")
        formatter = logging.Formatter("%(asctime)s [%(levelname)s] [%(filename)s:%(lineno)d] %(message)s")
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
        
    return logger