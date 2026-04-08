#!/bin/bash

# ═══════════════════════════════════════════════
#  CIVIS SERVER - Script de inicio
#  Mensajería instantánea tipo WhatsApp
# ═══════════════════════════════════════════════

COLORS="\033[0m"
CYAN="\033[1;36m"
GREEN="\033[1;32m"
YELLOW="\033[1;33m"
RED="\033[1;31m"
BOLD="\033[1m"
DIM="\033[2m"

clear

echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════╗${COLORS}"
echo -e "${CYAN}${BOLD}║        🏛️  CIVIS SERVER v1.0.0              ║${COLORS}"
echo -e "${CYAN}${BOLD}║     Mensajería instantánea tipo WhatsApp      ║${COLORS}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════╝${COLORS}"
echo ""

# Directorio base del script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"

# Cambiar al directorio del proyecto
cd "$PROJECT_DIR" || {
  echo -e "${RED}❌ No se pudo acceder al directorio: $PROJECT_DIR${COLORS}"
  exit 1
}

# =============================================
# FUNCIÓN: Verificar e instalar dependencias
# =============================================
check_node() {
  if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
    echo -e "  ✅ Node.js v${NODE_VERSION} $(command -v node)"
  else
    echo -e "  ❌ Node.js no está instalado"
    echo -e "${YELLOW}  → Instala Node.js desde: https://nodejs.org/${COLORS}"
    exit 1
  fi
}

check_npm() {
  if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm -v)
    echo -e "  ✅ npm v${NPM_VERSION}"
  else
    echo -e "  ❌ npm no está instalado"
    echo -e "${YELLOW}  → Instala Node.js desde: https://nodejs.org/${COLORS}"
    exit 1
  fi
}

install_deps() {
  if [ ! -d "node_modules" ] || [ ! -f "node_modules/express/package.json" ]; then
    echo -e "${YELLOW}📦 Instalando dependencias...${COLORS}"
    npm install --production 2>&1 | tail -1
    echo -e "  ✅ Dependencias instaladas"
  else
    echo -e "  ✅ Dependencias ya instaladas"
  fi
}

# =============================================
# FUNCIÓN: Base de datos
# =============================================
init_db() {
  mkdir -p data

  if [ ! -f "data/civis.db" ]; then
    echo -e "${YELLOW}🌱 Creando base de datos con datos de prueba...${COLORS}"
    node scripts/seed.js 2>&1 | grep -E "^(🌱|  ✅|  🧹|  👥|  🤝|  💬|  📨|  👥|  📱|  🏗|  📢|  🎉)" | head -20
    echo ""
  else
    echo -e "  ✅ Base de datos encontrada (data/civis.db)"
  fi
}

# =============================================
# FUNCIÓN: Crear directorios necesarios
# =============================================
create_dirs() {
  mkdir -p data uploads/avatars uploads/media uploads/status
  touch uploads/avatars/.gitkeep uploads/media/.gitkeep uploads/status/.gitkeep
}

# =============================================
# FUNCIÓN: Verificar puertos
# =============================================
check_port() {
  PORT=${1:-3001}
  if command -v lsof &> /dev/null; then
    PID=$(lsof -ti :$PORT 2>/dev/null)
  elif command -v ss &> /dev/null; then
    PID=$(ss -tlnp 2>/dev/null | grep ":$PORT " | grep -oP 'pid=\K[0-9]+' | head -1)
  elif command -v netstat &> /dev/null; then
    PID=$(netstat -tlnp 2>/dev/null | grep ":$PORT " | grep -oP 'LISTENING\s+\K[0-9]+' | head -1)
  fi

  if [ -n "$PID" ]; then
    return 1
  fi
  return 0
}

# =============================================
# MENÚ INTERACTIVO
# =============================================
show_menu() {
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS}"
  echo -e "${CYAN}${BOLD}              ¿Qué deseas hacer?${COLORS}"
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS}"
  echo ""
  echo -e "  ${GREEN}1.${COLORS} 🚀 Iniciar servidor (producción)"
  echo -e "  ${GREEN}2.${COLORS} 🛠️  Iniciar servidor (desarrollo con nodemon)"
  echo -e "  ${GREEN}3.${COLORS} 🌱 Re-seed base de datos (borra y recrea datos)"
  echo -e "  ${GREEN}4.${COLORS} 🧪 Ejecutar pruebas automáticas"
  echo -e "  ${GREEN}5.${COLORS} 🛑  Detener servidor"
  echo -e "  ${GREEN}6.${COLORS} 📋 Ver usuarios de prueba"
  echo -e "  ${GREEN}7.${COLORS} 📡 Probar conexión al servidor"
  echo -e "  ${GREEN}8.${COLORS} 🗑️  Reset completo (BD + logs)"
  echo -e "  ${RED}0.${COLORS} Salir"
  echo ""
}

# =============================================
# ACCIONES
# =============================================

start_prod() {
  PORT=3001
  if ! check_port $PORT; then
    echo -e "${YELLOW}⚠️  El puerto $PORT ya está en uso. Deteniendo proceso anterior...${COLORS}"
    pkill -f "node.*civis-server/src/server.js" 2>/dev/null
    sleep 2
  fi

  echo -e "${GREEN}🚀 Iniciando servidor Civis en modo producción...${COLORS}"
  echo -e "  📡 API: http://localhost:$PORT"
  echo -e "  📡 Socket.io: ws://localhost:$PORT"
  echo ""
  node src/server.js &
  SERVER_PID=$!
  echo $SERVER_PID > .civis.pid
  echo -e "  📌 PID: $SERVER_PID"
  echo -e "  ${DIM}Presiona Ctrl+C para detener${COLORS}"
  echo ""
}

start_dev() {
  if ! command -v npx &> /dev/null; then
    echo -e "${YELLOW}⚠️  nodemon no encontrado, usando node directamente${COLORS}"
    start_prod
    return
  fi

  PORT=3001
  if ! check_port $PORT; then
    echo -e "${YELLOW}⚠️  El puerto $PORT ya está en uso. Deteniendo proceso anterior...${COLORS}"
    pkill -f "civis-server" 2>/dev/null
    sleep 2
  fi

  echo -e "${GREEN}🛠️  Iniciando servidor Civis en modo desarrollo (nodemon)...${COLORS}"
  echo -e "  📡 API: http://localhost:$PORT"
  echo -e "  📡 Socket.io: ws://localhost:$PORT"
  echo -e "  🔄 Auto-restart al detectar cambios"
  echo ""
  npx nodemon src/server.js &
  SERVER_PID=$!
  echo $SERVER_PID > .civis.pid
  echo -e "  📌 PID: $SERVER_PID"
  echo -e "  ${DIM}Presiona Ctrl+C para detener${COLORS}"
  echo ""
}

seed_db() {
  echo -e "${YELLOW}🌱 Reiniciando base de datos...${COLORS}"
  rm -f data/civis.db data/civis.db-wal data/civis.db-shm
  node scripts/seed.js
  echo ""
}

run_tests() {
  echo -e "${GREEN}🧪 Ejecutando pruebas automatizadas...${COLORS}"
  echo ""
  node scripts/test.js
}

stop_server() {
  if [ -f .civis.pid ]; then
    PID=$(cat .civis.pid)
    if kill -0 $PID 2>/dev/null; then
      kill $PID 2>/dev/null
      echo -e "${GREEN}✅ Servidor detenido (PID: $PID)${COLORS}"
    else
      echo -e "${YELLOW}El proceso $PID ya no está corriendo${COLORS}"
    fi
    rm -f .civis.pid
  else
    pkill -f "civis-server" 2>/dev/null
    echo -e "${GREEN}✅ Servidor detenido${COLORS}"
  fi
}

show_users() {
  echo ""
  echo -e "${CYAN}${BOLD}🔑 Usuarios de prueba (contraseña: 123456 para todos)${COLORS}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS}"
  echo -e "  ${DIM}#   Email                          Username          Nombre${COLORS}"
  echo -e "  ${DIM}─   ──────────────────────────────── ──────────────────  ──────────────────${COLORS}"
  echo -e "  1   juan.perez@civis.app            @juanperez         Juan Pérez"
  echo -e "  2   maria.garcia@civis.app          @mariagarcia       María García"
  echo -e "  3   carlos.lopez@civis.app          @carloslopez       Carlos López"
  echo -e "  4   ana.martinez@civis.app          @anamartinez       Ana Martínez"
  echo -e "  5   pedro.sanchez@civis.app         @pedrosanchez      Pedro Sánchez"
  echo -e "  6   laura.torres@civis.app          @lauratorres       Laura Torres"
  echo -e "  7   diego.ramirez@civis.app         @diegoramirez      Diego Ramírez"
  echo -e "  8   sofia.hernandez@civis.app       @sofiahernandez    Sofía Hernández"
  echo ""
}

test_connection() {
  PORT=${1:-3001}
  echo -e "📡 Probando conexión a http://localhost:$PORT..."

  if command -v curl &> /dev/null; then
    RESPONSE=$(curl -s -m 3 http://localhost:$PORT/api/health 2>/dev/null)
    if [ -n "$RESPONSE" ]; then
      STATUS=$(echo "$RESPONSE" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
      if [ "$STATUS" = "ok" ]; then
        echo -e "${GREEN}✅ Servidor conectado${COLORS}"
        echo -e "  📡 API REST: http://localhost:$PORT/api"
        echo -e "  📡 Socket.io: ws://localhost:$PORT"
        return 0
      fi
    fi
  fi

  echo -e "${RED}❌ Servidor no responde en el puerto $PORT${COLORS}"
  return 1
}

full_reset() {
  echo -e "${YELLOW}🗑️  Reset completo...${COLORS}"
  stop_server
  rm -rf data/ node_modules/ .civis.pid
  create_dirs
  echo -e "${GREEN}✅ Reset completo. Ejecuta el script de nuevo para empezar desde cero.${COLORS}"
}

# =============================================
# LOOP PRINCIPAL
# =============================================

# Si se pasó un argumento directo, ejecutarlo
case "${1:-}" in
  start)
    create_dirs; check_node; check_npm; install_deps; init_db
    start_prod
    # Mantener vivo
    wait
    ;;
  dev)
    create_dirs; check_node; check_npm; install_deps; init_db
    start_dev
    wait
    ;;
  seed)
    create_dirs; seed_db
    ;;
  test)
    create_dirs; check_node; check_npm; install_deps; init_db
    # Asegurar servidor corriendo
    if ! check_port 3001; then
      stop_server
      sleep 1
    fi
    if ! check_port 3001; then
      node src/server.js > /dev/null 2>&1 &
      sleep 3
    fi
    run_tests
    ;;
  stop)
    stop_server
    ;;
  *)
    # Modo interactivo
    create_dirs
    echo -e "${CYAN}${BOLD}📋 Verificando entorno...${COLORS}"
    check_node
    check_npm
    echo ""

    while true; do
      show_menu
      read -p "$(echo -e ${CYAN}→${COLORS} Seleccione una opción: )" OPTION
      case $OPTION in
        1) start_prod ;;
        2) start_dev ;;
        3) seed_db ;;
        4)
          if ! check_port 3001; then
            echo -e "${YELLOW}⚠️  Iniciando servidor temporalmente para pruebas...${COLORS}"
            node src/server.js > /dev/null 2>&1 &
            sleep 3
          fi
          run_tests
          ;;
        5) stop_server ;;
        6) show_users ;;
        7) test_connection ;;
        8) full_reset ;;
        0|q|Q|exit|salir)
          echo -e "${CYAN}${BOLD}👋 ¡Hasta luego! Civis Server detenido.${COLORS}"
          exit 0
          ;;
        *)
          echo -e "${RED}❌ Opción no válida: $OPTION${COLORS}"
          ;;
      esac
    done
    ;;
esac
