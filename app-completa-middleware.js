const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const Joi = require('joi');

const app = express();

/* ======================
   Middlewares base
====================== */
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ======================
   Middleware Logger
====================== */
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

  res.on('finish', () => {
    console.log(`→ ${res.statusCode} (${Date.now() - start}ms)`);
  });

  next();
});

/* ======================
   Middleware i18n
====================== */
const mensajes = {
  es: {
    UNAUTHORIZED: 'Token requerido o inválido',
    FORBIDDEN: 'Permisos insuficientes',
    RATE_LIMIT: 'Demasiadas solicitudes, intenta más tarde',
    VALIDATION_ERROR: 'Datos inválidos',
    NOT_FOUND: 'Ruta no encontrada'
  },
  en: {
    UNAUTHORIZED: 'Authentication token required or invalid',
    FORBIDDEN: 'Insufficient permissions',
    RATE_LIMIT: 'Too many requests, try again later',
    VALIDATION_ERROR: 'Invalid data',
    NOT_FOUND: 'Route not found'
  }
};

app.use((req, res, next) => {
  const lang = req.headers['accept-language']?.startsWith('en') ? 'en' : 'es';
  req.t = (key) => mensajes[lang][key] || key;
  next();
});

/* ======================
   Rate limiting por ruta
====================== */
function rateLimit({ windowMs, max }) {
  const requests = new Map();

  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();

    if (!requests.has(key)) {
      requests.set(key, []);
    }

    const timestamps = requests.get(key).filter(t => now - t < windowMs);
    timestamps.push(now);
    requests.set(key, timestamps);

    if (timestamps.length > max) {
      return res.status(429).json({ error: req.t('RATE_LIMIT') });
    }

    next();
  };
}

/* ======================
   Middleware de caché GET
====================== */
const cache = new Map();

function cacheResponse(ttlMs) {
  return (req, res, next) => {
    if (req.method !== 'GET') return next();

    const key = req.originalUrl;

    if (cache.has(key)) {
      const { data, expiry } = cache.get(key);
      if (Date.now() < expiry) {
        return res.json({ ...data, cache: true });
      }
      cache.delete(key);
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      cache.set(key, {
        data: body,
        expiry: Date.now() + ttlMs
      });
      originalJson(body);
    };

    next();
  };
}

/* ======================
   Autenticación
====================== */
function validarAuth(req, res, next) {
  const auth = req.headers.authorization;

  if (!auth || auth !== 'Bearer mi-token-secreto') {
    return res.status(401).json({ error: req.t('UNAUTHORIZED') });
  }

  req.usuario = { id: 1, role: 'admin' };
  next();
}

/* ======================
   Validación con Joi
====================== */
function validarSchema(schema) {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: req.t('VALIDATION_ERROR'),
        detalles: error.details.map(d => d.message)
      });
    }
    next();
  };
}

/* ======================
   Esquemas Joi
====================== */
const usuarioSchema = Joi.object({
  nombre: Joi.string().min(3).required(),
  email: Joi.string().email().required(),
  activo: Joi.boolean()
});

/* ======================
   Datos simulados
====================== */
let usuarios = [
  { id: 1, nombre: 'Ana', email: 'ana@test.com', activo: true }
];

/* ======================
   Rutas
====================== */
app.get('/', (req, res) => {
  res.json({ mensaje: 'API con Middleware Avanzado' });
});

/* Login con rate limit */
app.post(
  '/auth/login',
  rateLimit({ windowMs: 60000, max: 5 }),
  (req, res) => {
    const { email, password } = req.body;
    if (email === 'admin@example.com' && password === 'admin123') {
      return res.json({ token: 'mi-token-secreto' });
    }
    res.status(401).json({ error: req.t('UNAUTHORIZED') });
  }
);

/* Usuarios con cache + auth */
app.get(
  '/api/usuarios',
  validarAuth,
  cacheResponse(30000),
  (req, res) => {
    res.json({ usuarios });
  }
);

/* Crear usuario con Joi */
app.post(
  '/api/usuarios',
  validarAuth,
  validarSchema(usuarioSchema),
  (req, res) => {
    const nuevo = { id: usuarios.length + 1, ...req.body };
    usuarios.push(nuevo);
    res.status(201).json(nuevo);
  }
);

/* ======================
   404
====================== */
app.use((req, res) => {
  res.status(404).json({ error: req.t('NOT_FOUND') });
});

/* ======================
   Start server
====================== */
app.listen(3000, () => {
  console.log('🚀 Servidor en http://localhost:3000');
});
