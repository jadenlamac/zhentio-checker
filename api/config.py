"""
Configuración centralizada para el sistema ZHENTIO CHECKER
"""

import os
from dataclasses import dataclass
from typing import Dict

@dataclass
class APIConfig:
    """Configuración de APIs externas"""
    CHECKER_URL: str = "https://zeuschkv2.xyz/us.php"
    BINLIST_URL: str = "https://api.binlist.net/v2"
    TIMEOUT: int = 30
    
@dataclass
class FlaskConfig:
    """Configuración del servidor Flask"""
    HOST: str = "127.0.0.1"
    PORT: int = 5000
    DEBUG: bool = True
    THREADED: bool = True
    
@dataclass
class SecurityConfig:
    """Configuración de seguridad"""
    SSL_VERIFY: bool = False
    RATE_LIMIT: str = "100 per hour"
    
@dataclass
class CreditConfig:
    """Configuración del sistema de créditos"""
    DEFAULT_CREDITS: int = 30
    LIVE_CARD_COST: int = 2
    DEAD_CARD_COST: int = 0
    
@dataclass
class LogConfig:
    """Configuración de logging"""
    LEVEL: str = "INFO"
    FORMAT: str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    FILE: str = "checker.log"
    MAX_BYTES: int = 10485760  # 10MB
    BACKUP_COUNT: int = 5

class Settings:
    """Configuración principal del sistema"""
    
    def __init__(self):
        self.api = APIConfig()
        self.flask = FlaskConfig()
        self.security = SecurityConfig()
        self.credits = CreditConfig()
        self.log = LogConfig()
        
        # Cargar variables de entorno si existen
        self._load_from_env()
    
    def _load_from_env(self):
        """Carga configuraciones desde variables de entorno"""
        # API Configuration
        self.api.CHECKER_URL = os.getenv("CHECKER_API_URL", self.api.CHECKER_URL)
        self.api.BINLIST_URL = os.getenv("BINLIST_API_URL", self.api.BINLIST_URL)
        self.api.TIMEOUT = int(os.getenv("API_TIMEOUT", self.api.TIMEOUT))
        
        # Flask Configuration
        self.flask.HOST = os.getenv("FLASK_HOST", self.flask.HOST)
        self.flask.PORT = int(os.getenv("FLASK_PORT", self.flask.PORT))
        self.flask.DEBUG = os.getenv("FLASK_DEBUG", "true").lower() == "true"
        
        # Credit Configuration
        self.credits.DEFAULT_CREDITS = int(os.getenv("DEFAULT_CREDITS", self.credits.DEFAULT_CREDITS))
        self.credits.LIVE_CARD_COST = int(os.getenv("LIVE_CARD_COST", self.credits.LIVE_CARD_COST))
        
        # Log Configuration
        self.log.LEVEL = os.getenv("LOG_LEVEL", self.log.LEVEL)
        self.log.FILE = os.getenv("LOG_FILE", self.log.FILE)

    @property
    def api_headers(self) -> Dict[str, str]:
        """Headers estándar para peticiones a APIs externas"""
        return {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "Origin": "https://lunarchk.vercel.app",
            "Referer": "https://lunarchk.vercel.app",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }

# Instancia global de configuración
settings = Settings()