#!/bin/bash

# =============================================================
#  Civis Server - Script de Inicio
# =============================================================
#  Servidor de mensajería tipo WhatsApp (Node.js + SQLite)
#
#  Uso:
#    chmod +x start.sh     (primera vez)
#    ./start.sh            (iniciar servidor)
#    ./start.sh --seed     (reiniciar DB y datos de prueba)
#    ./start.sh --test     (ejecutar pruebas)
#    ./start.sh --install  (reinstalar dependencias)
# =============================================================

set -e

# Colores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

PORT=3000
ACTION="start"

# Parsear argumentos
for arg in "$@"; do
    case $arg in
        --seed)   ACTION="seed"; shift ;;
        --test)   ACTION="test"; shift ;;
        --install) ACTION="install"; shift ;;
        --help|-h) 
            echo -e "${BLUE}Civis Server${NC}"
            echo ""
            echo -e "Uso: ${GREEN}./start.sh${NC} [opción]"
            echo ""
            echo "Opciones:"
            echo "  (sin opción)  Iniciar el servidor"
            echo "  --seed        Reiniciar base de datos con datos de prueba"
            echo "  --test        Ejecutar pruebas automatizadas"
            echo "  --install     Reinstalar dependencias de Node.js"
            echo "  --help, -h    Mostrar esta ayuda"
            echo ""
            echo "Usuarios de prueba:"
            echo -e "  ${YELLOW}carlos@civis.com${NC}  / password123"
            echo -e "  ${YELLOW}maria@civis.com${NC}    / password123"
            echo -e "  ${YELLOW}juan@civis.com${NC}     / password123"
            echo -e "  ${YELLOW}ana@civis.com${NC}      / password123"
            echo -e "  ${YELLOW}luis@civis.com${NC}     / password123"
            echo -e "  ${YELLOW}sofia@civis.com${NC}    / password123"
            echo -e "  ${YELLOW}diego@civis.com${NC}    / password123"
            echo -e "  ${YELLOW}valentina@civis.com${NC}/ password123"
            exit 0 ;;
    esac
done

echo ""
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         🟢  CIVIS SERVER  🟢         ║${NC}"
echo -e "${GREEN}║   Servidor de Mensajería             ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""

# Verificar Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js no está instalado.${NC}"
    echo -e "${YELLOW}Descárgalo en: https://nodejs.org/${NC}"
    exit 1
fi

NODE_VERSION=$(node -v)
echo -e "${BLUE}✓ Node.js $NODE_VERSION${NC}"

# Verificar npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm no está instalado.${NC}"
    exit 1
fi

echo -e "${BLUE}✓ npm $(npm -v)${NC}"

# Ir al directorio del proyecto
cd "$(dirname "$0")"

# Crear directorios necesarios
mkdir -p data uploads/avatars uploads/media uploads/status uploads/attachments
echo -e "${BLUE}✓ Directorios creados${NC}"

# Instalar dependencias si no existe node_modules
if [ ! -d "node_modules" ] || [ "$ACTION" = "install" ]; then
    echo ""
    echo -e "${YELLOW}📦 Instalando dependencias...${NC}"
    npm install --production
    echo -e "${GREEN}✓ Dependencias instaladas${NC}"
fi

# Acción: Seed
if [ "$ACTION" = "seed" ]; then
    echo ""
    echo -e "${YELLOW}🌱 Reiniciando base de datos con datos de prueba...${NC}"
    # Eliminar base de datos existente
    rm -f data/civis.db data/civis.db-shm data/civis.db-wal
    node scripts/seed.js
    echo -e "${GREEN}✓ Base de datos poblada con datos de prueba${NC}"
    echo ""
    echo -e "${GREEN}✅ Listo. Ahora ejecuta ./start.sh para iniciar el servidor${NC}"
    exit 0
fi

# Acción: Test
if [ "$ACTION" = "test" ]; then
    echo ""
    echo -e "${YELLOW}🧪 Ejecutando pruebas...${NC}"
    node scripts/test.js
    exit 0
fi

# Acción: Start (default)
# Verificar si la base de datos existe, si no, ejecutar seed
if [ ! -f "data/civis.db" ]; then
    echo ""
    echo -e "${YELLOW}🌱 Base de datos no encontrada. Creando con datos de prueba...${NC}"
    node scripts/seed.js
    echo -e "${GREEN}✓ Base de datos creada${NC}"
fi

echo ""
echo -e "${GREEN}🚀 Iniciando servidor en puerto $PORT...${NC}"
echo -e "${BLUE}📡 API:       http://localhost:$PORT/api${NC}"
echo -e "${BLUE}🔌 Socket.IO: http://localhost:$PORT${NC}"
echo -e "${BLUE}📂 Archivos:  http://localhost:$PORT/uploads${NC}"
echo ""
echo -e "${YELLOW}Presiona Ctrl+C para detener el servidor${NC}"
echo ""

# Iniciar el servidor con nodemon si está disponible, si no con node
if command -v npx &> /dev/null && grep -q "nodemon" package.json; then
    npx nodemon src/server.js
else
    node src/server.js
fi
