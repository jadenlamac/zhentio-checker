"""
ZHENTIO CHECKER - Sistema de Verificación de Tarjetas de Crédito
Backend API desarrollado con Flask

Autor: Sistema Zhentio
Versión: 2.0
Fecha: Noviembre 2025
"""

from flask import Flask, request, jsonify
import logging
import traceback
import urllib3
from datetime import datetime

# Importar configuración y servicios (USANDO . PARA IMPORTACIONES RELATIVAS)
from .config import settings
from .services import (
    ValidationService, 
    CreditService, 
    CheckerService, 
    BinService, 
    UtilsService
)

# Configuración de logging
# IMPORTANTE: Se elimina logging.FileHandler porque Vercel no permite escribir archivos en disco.
logging.basicConfig(
    level=getattr(logging, settings.log.LEVEL),
    format=settings.log.FORMAT,
    handlers=[
        # logging.FileHandler(settings.log.FILE), # ESTA LÍNEA ES ELIMINADA/COMENTADA
        logging.StreamHandler() # Solo se usa el StreamHandler para logs en la consola de Vercel
    ]
)
logger = logging.getLogger(__name__)

# Deshabilita advertencias sobre certificados SSL
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ========================= APLICACIÓN FLASK =========================
app = Flask(__name__)

# Configuración CORS
@app.after_request
def add_headers(response):
    """Añade headers CORS para permitir peticiones desde el frontend"""
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

@app.route('/', methods=['GET'])
def home():
    """Endpoint raíz con información del servicio"""
    return jsonify({
        "service": "Zhentio Checker API",
        "version": "2.0",
        "status": "Running",
        "endpoints": {
            "health": "/health",
            "check_card": "/check_cc",
            "stats": "/stats"
        },
        "timestamp": datetime.now().isoformat()
    })

@app.route('/health', methods=['GET'])
def health_check():
    """Endpoint de verificación de salud del servicio"""
    return jsonify({
        "status": "OK",
        "service": "Zhentio Checker API",
        "version": "2.0",
        "timestamp": datetime.now().isoformat()
    })

@app.route('/check_cc', methods=['POST', 'OPTIONS'])
def check_cc():
    """
    Endpoint principal para verificación de tarjetas de crédito
    
    Esperado en el request:
    {
        "cc": "1234567890123456|12|2025|123",
        "cookie": "session_cookie_string",
        "user_id": 123 (opcional)
    }
    
    Retorna:
    {
        "estado": "VIVA|MUERTA|ERROR|COOKIE_EXPIRADA|DESCONOCIDO",
        "cc": "tarjeta_formateada",
        "banco": "nombre_banco",
        "pais": "nombre_pais",
        "flag": "emoji_bandera",
        "raw": "respuesta_limpia_api",
        "timestamp": "2025-11-04T10:30:00"
    }
    """
    # Manejar preflight OPTIONS request
    if request.method == 'OPTIONS':
        return '', 200
    
    start_time = datetime.now()
    
    try:
        # Validación de entrada
        data = request.get_json()
        if not data:
            return jsonify({
                "estado": "ERROR", 
                "mensaje": "No se recibieron datos JSON válidos"
            }), 400

        tarjeta = data.get('cc', '').strip()
        cookie = data.get('cookie', '').strip()
        user_id = data.get('user_id', 999999)

        # Log de inicio de proceso
        masked_card = UtilsService.mask_card_number(tarjeta)
        logger.info(f"[{user_id}] Iniciando verificación de tarjeta {masked_card}")

        # Validaciones básicas
        if not tarjeta or not cookie:
            logger.warning(f"[{user_id}] Datos incompletos en la solicitud")
            return jsonify({
                "estado": "ERROR", 
                "mensaje": "Datos incompletos: se requieren 'cc' y 'cookie'"
            }), 400

        # Validar formato de tarjeta
        if not ValidationService.validate_cc_format(tarjeta):
            logger.warning(f"[{user_id}] Formato de tarjeta inválido: {masked_card}")
            return jsonify({
                "estado": "ERROR", 
                "mensaje": "Formato de tarjeta inválido. Use: CC|MM|AAAA|CVV"
            }), 400

        # Validar cookie
        if not ValidationService.validate_cookie(cookie):
            logger.warning(f"[{user_id}] Cookie inválida")
            return jsonify({
                "estado": "ERROR", 
                "mensaje": "Cookie inválida o vacía"
            }), 400

        # Verificar créditos disponibles
        if not CreditService.has_sufficient_credits(user_id):
            logger.warning(f"[{user_id}] Créditos insuficientes")
            return jsonify({
                "estado": "ERROR", 
                "mensaje": "Créditos insuficientes"
            }), 402  # Payment Required

        # Realizar verificación con la API externa
        api_result = CheckerService.check_card_with_api(tarjeta, cookie)
        
        if not api_result['success']:
            logger.error(f"[{user_id}] Error en API externa: {api_result['error']}")
            return jsonify({
                "estado": "ERROR", 
                "mensaje": f"Error de API: {api_result['error']}"
            }), 500

        raw_response = api_result['data']
        
        # Log de respuesta de API (parcial por seguridad)
        logger.info(f"[{user_id}] Respuesta API recibida: {len(raw_response)} caracteres")

        # Verificar si la cookie está expirada
        if CheckerService.check_cookie_expired(raw_response):
            logger.warning(f"[{user_id}] Cookie expirada detectada")
            return jsonify({
                "estado": "COOKIE_EXPIRADA", 
                "mensaje": "Cookie inválida o expirada. Reemplázala.",
                "cc": tarjeta,
                "timestamp": datetime.now().isoformat()
            }), 200

        # Determinar estado de la tarjeta
        card_status = CheckerService.determine_card_status(raw_response)
        logger.info(f"[{user_id}] Estado determinado: {card_status} para {masked_card}")
        
        # Descontar créditos si la tarjeta está VIVA
        if card_status == "VIVA":
            success = CreditService.deduct_credits(user_id, settings.credits.LIVE_CARD_COST)
            if success:
                logger.info(f"[{user_id}] Créditos descontados: -{settings.credits.LIVE_CARD_COST}")
            else:
                logger.error(f"[{user_id}] Error al descontar créditos")

        # Obtener información del BIN
        bin_code = tarjeta.split('|')[0][:6]
        bin_info = BinService.get_bin_info(bin_code)

        # Calcular tiempo de procesamiento
        processing_time = (datetime.now() - start_time).total_seconds()

        # Preparar respuesta
        result = {
            "estado": card_status,
            "cc": tarjeta,
            "banco": bin_info["banco"],
            "pais": bin_info["pais"],
            "flag": bin_info["flag"],
            "raw": UtilsService.clean_html(raw_response),
            "timestamp": datetime.now().isoformat(),
            "processing_time": f"{processing_time:.2f}s"
        }

        logger.info(f"[{user_id}] Verificación completada en {processing_time:.2f}s: {card_status}")
        return jsonify(result)

    except Exception as e:
        logger.error(f"[{user_id if 'user_id' in locals() else 'Unknown'}] Error inesperado: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({
            "estado": "ERROR", 
            "mensaje": f"Error interno del servidor",
            "timestamp": datetime.now().isoformat()
        }), 500

@app.route('/stats', methods=['GET'])
def get_stats():
    """Endpoint para obtener estadísticas del sistema"""
    # TODO: Implementar estadísticas reales desde base de datos
    return jsonify({
        "total_checks": 0,
        "live_cards": 0,
        "dead_cards": 0,
        "errors": 0,
        "uptime": "Running",
        "version": "2.0",
        "timestamp": datetime.now().isoformat()
    })

@app.errorhandler(404)
def not_found(error):
    """Manejador de errores 404"""
    return jsonify({
        "error": "Endpoint no encontrado",
        "message": "La ruta solicitada no existe",
        "timestamp": datetime.now().isoformat()
    }), 404

@app.errorhandler(500)
def internal_error(error):
    """Manejador de errores 500"""
    logger.error(f"Error 500: {str(error)}")
    return jsonify({
        "error": "Error interno del servidor",
        "message": "Ocurrió un error inesperado",
        "timestamp": datetime.now().isoformat()
    }), 500

# IMPORTANTE: Se elimina todo el bloque `if __name__ == '__main__':`
# Vercel solo importa la variable 'app', no ejecuta el bloque del servidor local.
# if __name__ == '__main__':
#     logger.info("=" * 50)
#     # ... (código de ejecución local eliminado)
