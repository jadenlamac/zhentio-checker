"""
Servicios del sistema ZHENTIO CHECKER
Contiene toda la lógica de negocio separada del controlador Flask
"""

import re
import requests
import logging
from typing import Tuple, Optional, Dict, Any

# IMPORT ROBUSTO: intenta import relativo (cuando se ejecuta como paquete)
# y si falla, hace fallback al import absoluto (ejecución local).
try:
    from .config import settings
except Exception:
    from config import settings

logger = logging.getLogger(__name__)

class ValidationService:
    """Servicio para validación de datos de entrada"""
    
    @staticmethod
    def validate_cc_format(cc: str) -> bool:
        """
        Valida el formato de la tarjeta de crédito
        Formato esperado: CC|MM|AAAA|CVV donde todos son dígitos
        """
        if not cc or not isinstance(cc, str):
            return False
            
        parts = cc.strip().split('|')
        if len(parts) != 4:
            return False
            
        cc_number, month, year, cvv = parts
        
        # Validar que todos sean numéricos
        if not all(part.isdigit() for part in parts):
            return False
            
        # Validar longitudes
        if not (13 <= len(cc_number) <= 19):  # Rango común de tarjetas
            return False
        if len(month) != 2 or not (1 <= int(month) <= 12):
            return False
        if len(year) != 4 or int(year) < 2024:
            return False
        if not (3 <= len(cvv) <= 4):
            return False
            
        return True
    
    @staticmethod
    def validate_cookie(cookie: str) -> bool:
        """Valida básicamente que la cookie no esté vacía"""
        return bool(cookie and cookie.strip())

class CreditService:
    """Servicio para manejo de créditos de usuario"""
    
    @staticmethod
    def get_credits(user_id: int) -> Tuple[Optional[str], int]:
        """
        Obtiene los créditos disponibles del usuario
        TODO: Implementar conexión a base de datos real
        """
        logger.info(f"Consultando créditos para usuario {user_id}")
        # Simulación - en producción conectar a BD
        return None, settings.credits.DEFAULT_CREDITS
    
    @staticmethod
    def deduct_credits(user_id: int, amount: int) -> bool:
        """
        Descuenta créditos del usuario
        TODO: Implementar descuento en base de datos real
        """
        logger.info(f"Descontando {amount} créditos a usuario {user_id}")
        # Simulación - en producción actualizar BD
        return True
    
    @staticmethod
    def has_sufficient_credits(user_id: int, required: int = None) -> bool:
        """Verifica si el usuario tiene créditos suficientes"""
        if required is None:
            required = settings.credits.LIVE_CARD_COST
            
        _, current_credits = CreditService.get_credits(user_id)
        return current_credits >= required

class CheckerService:
    """Servicio principal para verificación de tarjetas"""
    
    # Patrones para detectar cookies expiradas
    COOKIE_EXPIRED_PATTERNS = [
        r"cookie expirada", r"invalid cookie", r"session expired",
        r"cookie inválida", r"login required", r"please login",
        r"autenticaci[oó]n requerida", r"conta sem endereço", 
        r"coloque os cookies da amazon", r"authentication required"
    ]
    
    # Patrones para tarjetas VIVAS
    LIVE_PATTERNS = [
        r"aprovada", r"tarjeta autorizada", r"aprovado", 
        r"approved", r"success", r"authorized"
    ]
    
    # Patrones para tarjetas MUERTAS
    DEAD_PATTERNS = [
        r"reprovada", r"rechazada", r"recusado", 
        r"declined", r"rejected", r"failed"
    ]
    
    @staticmethod
    def check_cookie_expired(html: str) -> bool:
        """Verifica si el HTML indica una cookie expirada o inválida"""
        if not html:
            return False
            
        return any(
            re.search(pattern, html, re.I) 
            for pattern in CheckerService.COOKIE_EXPIRED_PATTERNS
        )
    
    @staticmethod
    def determine_card_status(response_text: str) -> str:
        """Determina el estado de la tarjeta basado en la respuesta de la API"""
        if not response_text:
            return "DESCONOCIDO"
            
        text_lower = response_text.lower()
        
        # Verificar patrones de tarjeta VIVA
        if any(re.search(pattern, text_lower) for pattern in CheckerService.LIVE_PATTERNS):
            return "VIVA"
        
        # Verificar patrones de tarjeta MUERTA
        if any(re.search(pattern, text_lower) for pattern in CheckerService.DEAD_PATTERNS):
            return "MUERTA"
        
        return "DESCONOCIDO"
    
    @staticmethod
    def check_card_with_api(tarjeta: str, cookie: str) -> Dict[str, Any]:
        """
        Realiza la verificación de la tarjeta con la API externa
        
        Returns:
            Dict con 'success', 'data' o 'error'
        """
        try:
            payload = {
                "lista": tarjeta,
                "cookies": cookie
            }
            
            response = requests.post(
                settings.api.CHECKER_URL,
                headers=settings.api_headers,
                data=payload,
                timeout=settings.api.TIMEOUT,
                verify=settings.security.SSL_VERIFY
            )
            
            if response.status_code != 200:
                return {
                    'success': False,
                    'error': f"API returned status code {response.status_code}"
                }
            
            return {
                'success': True,
                'data': response.text
            }
            
        except requests.exceptions.Timeout:
            return {
                'success': False,
                'error': "Timeout: API request took too long"
            }
        except requests.exceptions.RequestException as e:
            return {
                'success': False,
                'error': f"Connection error: {str(e)}"
            }
        except Exception as e:
            return {
                'success': False,
                'error': f"Unexpected error: {str(e)}"
            }

class BinService:
    """Servicio para consulta de información BIN"""
    
    @staticmethod
    def get_bin_info(bin_code: str) -> Dict[str, str]:
        """
        Obtiene información del BIN de la tarjeta usando la API de Binlist
        
        Args:
            bin_code: Primeros 6 dígitos de la tarjeta
            
        Returns:
            Dict con información del banco y país
        """
        default_info = {
            "banco": "N/A", 
            "pais": "N/A", 
            "flag": ""
        }
        
        if not bin_code or len(bin_code) < 6:
            logger.warning(f"BIN code inválido: {bin_code}")
            return default_info
        
        # Asegurar que solo se usen los primeros 6 dígitos
        bin_code = bin_code[:6]
        
        try:
            response = requests.get(
                f"{settings.api.BINLIST_URL}/{bin_code}",
                timeout=10  # Timeout más corto para BIN lookup
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Extraer información del banco
                bank_info = data.get("bank", {})
                bank_name = bank_info.get("name", "N/A")
                
                # Extraer información del país
                country_info = data.get("country", {})
                country_name = country_info.get("name", "N/A")
                country_code = country_info.get("alpha2", "")
                
                return {
                    "banco": bank_name,
                    "pais": country_name,
                    "flag": UtilsService.get_flag(country_code)
                }
            else:
                logger.warning(f"BIN API returned status {response.status_code} for {bin_code}")
                
        except requests.exceptions.Timeout:
            logger.warning(f"Timeout al consultar BIN {bin_code}")
        except Exception as e:
            logger.warning(f"Error al consultar BIN {bin_code}: {str(e)}")
            
        return default_info

class UtilsService:
    """Servicio con utilidades generales"""
    
    @staticmethod
    def get_flag(country_code: str) -> str:
        """
        Convierte un código de país alpha-2 a un emoji de bandera
        
        Args:
            country_code: Código de país de 2 letras (ej: "US", "BR")
            
        Returns:
            Emoji de bandera correspondiente
        """
        if not country_code or len(country_code) != 2:
            return ""
        
        try:
            # Convertir a mayúsculas y generar emoji
            code = country_code.upper()
            flag = chr(127397 + ord(code[0])) + chr(127397 + ord(code[1]))
            return flag
        except Exception as e:
            logger.debug(f"Error generando bandera para {country_code}: {str(e)}")
            return ""
    
    @staticmethod
    def clean_html(raw_html: str) -> str:
        """
        Elimina etiquetas HTML de una cadena y limpia el texto
        
        Args:
            raw_html: Texto con posibles etiquetas HTML
            
        Returns:
            Texto limpio sin etiquetas HTML
        """
        if not raw_html:
            return ""
        
        # Remover etiquetas HTML
        clean_text = re.sub(re.compile('<.*?>'), '', raw_html)
        
        # Limpiar espacios extra y caracteres especiales
        clean_text = re.sub(r'\s+', ' ', clean_text)
        clean_text = clean_text.strip()
        
        return clean_text
    
    @staticmethod
    def mask_card_number(cc: str) -> str:
        """
        Enmascara el número de tarjeta para logs de seguridad
        
        Args:
            cc: Tarjeta en formato CC|MM|AAAA|CVV
            
        Returns:
            Número enmascarado (ej: 1234**********56)
        """
        if not cc or '|' not in cc:
            return "****"
        
        parts = cc.split('|')
        if len(parts) < 1:
            return "****"
        
        card_number = parts[0]
        if len(card_number) < 8:
            return "****"
        
        # Mostrar primeros 4 y últimos 2 dígitos
        return f"{card_number[:4]}{'*' * (len(card_number) - 6)}{card_number[-2:]}"
