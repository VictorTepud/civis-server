/**
 * Middleware to handle camelCase/snake_case conversion between Android app and server.
 * - Converts incoming request bodies from camelCase to snake_case
 * - Converts outgoing response bodies from snake_case to camelCase
 * - Wraps all responses in standard format: { success: true, data: ... }
 */

function toSnakeCase(str) {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function toCamelCase(str) {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function isPlainObject(obj) {
  return obj && typeof obj === 'object' && obj.constructor === Object;
}

function convertKeys(obj, converter) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(item => convertKeys(item, converter));
  if (!isPlainObject(obj)) return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    result[converter(key)] = convertKeys(value, converter);
  }
  return result;
}

function convertToSnakeCase(obj) {
  return convertKeys(obj, toSnakeCase);
}

function convertToCamelCase(obj) {
  return convertKeys(obj, toCamelCase);
}

// Request middleware: camelCase → snake_case
function requestFormatMiddleware(req, res, next) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    req.body = convertToSnakeCase(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = convertToSnakeCase(req.query);
  }
  if (req.params && typeof req.params === 'object') {
    req.params = convertToSnakeCase(req.params);
  }
  next();
}

// Response middleware: wrap in standard format + snake_case → camelCase
function responseFormatMiddleware(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = function (data) {
    // Don't double-wrap if already has success field
    if (data && typeof data === 'object' && 'success' in data) {
      return originalJson(convertToCamelCase(data));
    }

    // Error responses
    if (res.statusCode >= 400 || (data && data.error)) {
      return originalJson(convertToCamelCase({
        success: false,
        message: (data && (data.error || data.message)) || 'Error desconocido'
      }));
    }

    // Success responses - wrap in standard format
    const wrapped = { success: true };

    if (data !== null && data !== undefined) {
      if (typeof data === 'object') {
        wrapped.data = data;
      } else {
        wrapped.message = String(data);
        wrapped.data = null;
      }
    } else {
      wrapped.data = null;
    }

    return originalJson(convertToCamelCase(wrapped));
  };

  next();
}

module.exports = { requestFormatMiddleware, responseFormatMiddleware, convertToSnakeCase, convertToCamelCase };
